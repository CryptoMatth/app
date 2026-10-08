/* eslint-disable no-undef */
/**
 * Expo config plugin: force-remove media permissions from the final
 * Android manifest, in a way that survives library merges.
 *
 * `android.blockedPermissions` works at Expo prebuild time, but a merge
 * step from a library AAR can still re-introduce `READ_MEDIA_IMAGES` /
 * `READ_MEDIA_VIDEO`. Google Play rejects any APK/AAB whose merged
 * manifest declares those broad permissions when a system Photo Picker
 * is available (Android 13+, API 33+).
 *
 * This plugin inserts explicit `<uses-permission ... tools:node="remove"/>`
 * entries that instruct the Android manifest merger to strip these
 * permissions from the final merged manifest, no matter which library
 * declared them.
 *
 * See: https://developer.android.com/build/manage-manifests#merge-rule-markers
 */
const { withAndroidManifest } = require('expo/config-plugins');

const PERMISSIONS_TO_REMOVE = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

function withRemoveMediaPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // Ensure the tools namespace is declared, otherwise `tools:node="remove"` is a no-op.
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    manifest['uses-permission'] = manifest['uses-permission'] || [];

    for (const perm of PERMISSIONS_TO_REMOVE) {
      // Drop any existing declaration (granted or already-blocked) first,
      // so we end up with exactly one "remove" marker per permission.
      manifest['uses-permission'] = manifest['uses-permission'].filter(
        (p) => p?.$?.['android:name'] !== perm,
      );
      manifest['uses-permission'].push({
        $: {
          'android:name': perm,
          'tools:node': 'remove',
        },
      });
    }

    return cfg;
  });
}

module.exports = withRemoveMediaPermissions;
