import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_ONBOARDING = 'planeat_tutorial_seen_v1';
const KEY_TIP_PREFIX = 'planeat_tip_';

export const TutorialKeys = {
  onboarding: KEY_ONBOARDING,
  tipPiatti: `${KEY_TIP_PREFIX}piatti_v1`,
  tipPlanner: `${KEY_TIP_PREFIX}planner_v1`,
  tipSpesa: `${KEY_TIP_PREFIX}spesa_v1`,
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

export async function resetAllTutorial(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      TutorialKeys.onboarding,
      TutorialKeys.tipPiatti,
      TutorialKeys.tipPlanner,
      TutorialKeys.tipSpesa,
    ]);
  } catch {}
}
