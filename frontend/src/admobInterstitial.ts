/**
 * Google AdMob Interstitial helper for Planibble.
 *
 * Behaviour:
 *   - Initializes the native SDK at app start.
 *   - Pre-loads one Interstitial ad in the background.
 *   - Exposes `maybeShowInterstitialOnSave(hasProPlus)` which bumps a counter and,
 *     on every 5th eligible save, shows the interstitial if currently loaded.
 *   - After the ad is closed (or on load error) it eagerly reloads for the next time.
 *   - Pro+ users bypass the entire pipeline (no counter, no load, no show).
 *   - Expo Go and web gracefully no-op (the native module is not available there).
 *
 * NOTE: `react-native-google-mobile-ads` is a native module. Real ads will only
 * show inside an EAS build (dev client / preview / production), NEVER in Expo Go.
 */
import { Platform } from 'react-native';

const PROD_INTERSTITIAL = 'ca-app-pub-3617902293688046/3175882075';
// Google-provided demo IDs — safe to show during development.
const TEST_INTERSTITIAL = 'ca-app-pub-3940256099942544/1033173712';

const AD_UNIT_ID = __DEV__ ? TEST_INTERSTITIAL : PROD_INTERSTITIAL;
const SAVE_INTERVAL = 5;

type Interstitial = {
  load: () => void;
  show: () => Promise<void>;
  addAdEventListener: (event: string, callback: (...args: any[]) => void) => () => void;
};

type AdmobApi = {
  default: () => { initialize: () => Promise<unknown> };
  InterstitialAd: {
    createForAdRequest: (id: string) => Interstitial;
  };
  AdEventType: {
    LOADED: string;
    CLOSED: string;
    ERROR: string;
  };
};

let native: AdmobApi | null = null;
let interstitial: Interstitial | null = null;
let initialized = false;
let loaded = false;
let saveCount = 0;
let unsubscribers: (() => void)[] = [];

function getNative(): AdmobApi | null {
  if (Platform.OS === 'web') return null;
  if (native) return native;
  try {
    // Defensive require — Expo Go lacks the native binary.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    native = require('react-native-google-mobile-ads') as AdmobApi;
    return native;
  } catch {
    return null;
  }
}

/** Initialize AdMob and start pre-loading the first interstitial. Call once at app start. */
export async function initializeAdMob(): Promise<void> {
  const api = getNative();
  if (!api || initialized) return;
  initialized = true;

  try {
    await api.default().initialize();
    interstitial = api.InterstitialAd.createForAdRequest(AD_UNIT_ID);

    unsubscribers.push(
      interstitial.addAdEventListener(api.AdEventType.LOADED, () => {
        loaded = true;
      }),
      interstitial.addAdEventListener(api.AdEventType.CLOSED, () => {
        loaded = false;
        try { interstitial?.load(); } catch { /* no-op */ }
      }),
      interstitial.addAdEventListener(api.AdEventType.ERROR, () => {
        loaded = false;
      }),
    );

    interstitial.load(); // kick off the first preload
  } catch {
    // Ads must never prevent the app from booting.
    initialized = false;
    interstitial = null;
  }
}

/**
 * Call AFTER a successful save (dish, planner slot, shopping item, pantry item).
 * Pro+ users bypass. On every 5th eligible save, shows the interstitial if loaded.
 */
export async function maybeShowInterstitialOnSave(hasProPlus: boolean): Promise<void> {
  if (hasProPlus) return;
  if (Platform.OS === 'web') return;
  const api = getNative();
  if (!api || !interstitial) return;

  saveCount += 1;
  if (saveCount % SAVE_INTERVAL !== 0) return;

  if (!loaded) {
    // No ad ready right now — try to prime one for next time, but don't block the save.
    try { interstitial.load(); } catch { /* no-op */ }
    return;
  }

  loaded = false;
  try {
    await interstitial.show();
    // CLOSED listener will reload automatically after dismissal.
  } catch {
    try { interstitial.load(); } catch { /* no-op */ }
  }
}

/** For tests / dev tooling only. */
export function _resetAdStateForTests(): void {
  saveCount = 0;
}

export function disposeAdMob(): void {
  unsubscribers.forEach((remove) => {
    try { remove(); } catch { /* no-op */ }
  });
  unsubscribers = [];
  interstitial = null;
  initialized = false;
  loaded = false;
}
