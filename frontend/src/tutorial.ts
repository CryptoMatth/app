import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_ONBOARDING = 'planeat_tutorial_seen_v1';
const KEY_TIP_PREFIX = 'planeat_tip_';

export const TutorialKeys = {
  onboarding: KEY_ONBOARDING,
  tipPiatti: `${KEY_TIP_PREFIX}piatti_v1`,
  tipDishEditor: `${KEY_TIP_PREFIX}dish_editor_v1`,
  tipPlanner: `${KEY_TIP_PREFIX}planner_v1`,
  tipSpesa: `${KEY_TIP_PREFIX}spesa_v1`,
  tipDispensa: `${KEY_TIP_PREFIX}dispensa_v1`,
};

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY_ONBOARDING);
    return v === '1';
  } catch { return false; }
}

export async function markOnboardingSeen(): Promise<void> {
  try { await AsyncStorage.setItem(KEY_ONBOARDING, '1'); } catch {}
}

export async function hasSeenTip(key: string): Promise<boolean> {
  try { const v = await AsyncStorage.getItem(key); return v === '1'; } catch { return false; }
}

export async function markTipSeen(key: string): Promise<void> {
  try { await AsyncStorage.setItem(key, '1'); } catch {}
}

/* --------------------------------------------------------------------------
 * Live-reset signal for TipBanner.
 *
 * TipBanner reads AsyncStorage ONCE at mount; without this signal the banners
 * stay invisible until the component itself re-mounts (e.g. app restart).
 * Hitting "Mostra di nuovo i suggerimenti" in Settings would silently do
 * nothing because the already-mounted banners never re-read their key.
 *
 * We expose a tiny pub/sub so TipBanner can subscribe and re-read on reset.
 * -------------------------------------------------------------------------*/
let tipsVersion = 0;
const tipsListeners = new Set<() => void>();

export function getTipsVersion(): number {
  return tipsVersion;
}

export function subscribeTipsVersion(cb: () => void): () => void {
  tipsListeners.add(cb);
  return () => { tipsListeners.delete(cb); };
}

function bumpTipsVersion() {
  tipsVersion += 1;
  for (const l of Array.from(tipsListeners)) {
    try { l(); } catch {}
  }
}

/** Wipe every tip key (not just the known ones) and signal subscribers so
 *  banners re-render immediately without needing an app restart. */
export async function resetAllTutorial(): Promise<void> {
  try {
    // Prefix-based wipe so we don't need to know every key in advance.
    const allKeys = await AsyncStorage.getAllKeys();
    const tipKeys = allKeys.filter(k => k.startsWith(KEY_TIP_PREFIX));
    const toRemove = [KEY_ONBOARDING, ...tipKeys];
    if (toRemove.length > 0) {
      await AsyncStorage.multiRemove(toRemove);
    }
  } catch {}
  // Signal every mounted TipBanner to re-check its storage key.
  bumpTipsVersion();
}

/** Reset ONLY the small contextual tip banners (not the full onboarding
 *  slides). Used by the Settings → "Mostra di nuovo i suggerimenti" button
 *  so the user doesn't get forced through the whole intro again. */
export async function resetTipsOnly(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const tipKeys = allKeys.filter(k => k.startsWith(KEY_TIP_PREFIX));
    if (tipKeys.length > 0) {
      await AsyncStorage.multiRemove(tipKeys);
    }
  } catch {}
  bumpTipsVersion();
}
