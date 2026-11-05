/* eslint-disable no-undef */
/**
 * Expo config plugin: turn on full R8 optimization for Android release builds.
 *
 * Google Play Console flags:
 *  - "Optimization is not enabled"  → release uses `proguard-android.txt`
 *    (which contains `-dontoptimize`). We switch to `proguard-android-optimize.txt`.
 *  - "Optimized resource shrinking is not enabled" → enable the AGP flag
 *    `android.r8.optimizedResourceShrinking`.
 *
 * Keep rules for AdMob / RevenueCat / Expo live in `expo-build-properties`
 * (extraProguardRules) in app.json.
 */
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

function withOptimizeProguardFile(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /getDefaultProguardFile\(\s*["']proguard-android\.txt["']\s*\)/g,
      'getDefaultProguardFile("proguard-android-optimize.txt")',
    );
    return cfg;
  });
}

function withOptimizedResourceShrinking(config) {
  return withGradleProperties(config, (cfg) => {
    const key = 'android.r8.optimizedResourceShrinking';
    cfg.modResults = cfg.modResults.filter((p) => !(p.type === 'property' && p.key === key));
    cfg.modResults.push({ type: 'property', key, value: 'true' });
    return cfg;
  });
}

module.exports = function withR8Optimize(config) {
  return withOptimizedResourceShrinking(withOptimizeProguardFile(config));
};
