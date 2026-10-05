/**
 * Web stub for the AdMob interstitial helper.
 *
 * The real `react-native-google-mobile-ads` module ships native-only code
 * (GoogleMobileAdsBannerViewNativeComponent) that Metro cannot bundle for web.
 * This stub is picked up automatically by Metro's platform extension resolver
 * when bundling for `web`, so the app continues to boot in the browser preview
 * and no ad logic ever runs there.
 */
export async function initializeAdMob(): Promise<void> {
  /* no-op on web */
}

export async function maybeShowInterstitialOnSave(_hasProPlus: boolean): Promise<void> {
  /* no-op on web */
}

export function _resetAdStateForTests(): void {
  /* no-op on web */
}

export function disposeAdMob(): void {
  /* no-op on web */
}
