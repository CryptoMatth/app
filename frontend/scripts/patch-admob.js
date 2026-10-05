#!/usr/bin/env node
/* eslint-disable no-undef */
/**
 * Patch script: fixes a typo in react-native-google-mobile-ads@17.x that
 * breaks Android Gradle builds.
 *
 * The upstream `android/app-json.gradle` script has a typo on line 53:
 *   `rootProject.ext.googleAdsJson = false`
 * where it should set `googleMobileAdsJson`. When app.json exists but does
 * not have a top-level `react-native-google-mobile-ads` key (which happens
 * after the Emergent/EAS build pipeline serializes only the `expo` block
 * back into app.json), the `googleMobileAdsJson` extra property is never
 * created and Gradle fails with:
 *
 *   > Cannot get property 'googleMobileAdsJson' on extra properties extension
 *   > as it does not exist
 *
 * This script rewrites the offending line so the correct property is
 * always set, no matter what app.json looks like. It is idempotent and
 * safe to run multiple times; a no-op if the upstream has been fixed.
 *
 * Runs automatically via the `postinstall` npm script in both local dev
 * and EAS Build.
 */
const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-google-mobile-ads',
  'android',
  'app-json.gradle',
);

try {
  if (!fs.existsSync(target)) {
    // Module not installed in this tree — nothing to do.
    process.exit(0);
  }
  const original = fs.readFileSync(target, 'utf8');
  const BAD = 'rootProject.ext.googleAdsJson = false';
  const GOOD = 'rootProject.ext.googleMobileAdsJson = false';

  if (!original.includes(BAD)) {
    // Already patched or upstream fixed.
    process.exit(0);
  }
  const patched = original.split(BAD).join(GOOD);
  fs.writeFileSync(target, patched, 'utf8');
  console.log('[patch-admob] fixed googleMobileAdsJson typo in react-native-google-mobile-ads/android/app-json.gradle');
} catch (err) {
  // Never fail install because of this patch — just warn and continue.
  console.warn('[patch-admob] skipped:', err.message);
  process.exit(0);
}
