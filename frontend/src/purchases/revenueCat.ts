/**
 * RevenueCat client wrapper — Android only for now.
 *
 * Guards every native call with:
 *   1. Platform.OS === 'android'  (web/iOS silently no-op)
 *   2. isRevenueCatConfigured()   (missing/empty API key → no-op)
 *
 * PRICING MODEL (Play Store & RevenueCat setup):
 *
 *   Pro (one-time / non-consumable in-app product):
 *     Google Play product id:  pro_lifetime          €3
 *     RevenueCat entitlement:  "pro"
 *     Attached package type:   LIFETIME
 *
 *   Pro+ (subscription — one subscription with TWO base plans):
 *     Google Play subscription id: pro_plus_subscription
 *       ├── monthly base plan  €2/mese
 *       └── annual  base plan  €20/anno
 *     RevenueCat entitlement:  "pro_plus"
 *     Attached packages:
 *       - $rc_monthly (PackageType.MONTHLY)
 *       - $rc_annual  (PackageType.ANNUAL)
 *
 * Users on Pro who want to move to Pro+ simply subscribe to Pro+; both
 * entitlements can be granted (webhook handles that). The one-time
 * "pro_to_pro_plus_upgrade" product from the previous model is no longer
 * used — kept only as a legacy id so old purchases still restore.
 */
import { Platform } from 'react-native';
import Purchases, {
  CustomerInfo,
  LOG_LEVEL,
  PACKAGE_TYPE,
  PurchasesPackage,
} from 'react-native-purchases';

export const REVENUECAT_KEY = process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY?.trim() || '';

/**
 * Google Play product identifiers.
 *
 * Note: for subscriptions we identify PACKAGES by PackageType (MONTHLY/ANNUAL)
 * — Google Play subscriptions expose one subscription ID with multiple base
 * plans, and RevenueCat normalises them into packages.
 */
export const PRODUCT_IDS = {
  pro: 'pro_lifetime',
  proPlusSubscriptionId: 'pro_plus_subscription',   // Google Play SUBSCRIPTION id (both base plans)
  legacyProPlusLifetime: 'pro_plus_lifetime',        // legacy one-time, still restorable
  legacyUpgrade: 'pro_to_pro_plus_upgrade',          // legacy one-time, still restorable
} as const;

export type EntitlementKey = 'pro' | 'pro_plus';

/**
 * Frontend Pro+ package selection key.
 *   'monthly' → 2€/mese
 *   'annual'  → 20€/anno
 */
export type ProPlusInterval = 'monthly' | 'annual';

export function isRevenueCatConfigured(): boolean {
  return Platform.OS === 'android' && REVENUECAT_KEY.startsWith('goog_');
}

/** Configure the SDK exactly once (called from the root layout). */
export function configureRevenueCat(appUserID?: string | null) {
  if (!isRevenueCatConfigured()) return;
  try {
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR);
    Purchases.configure({
      apiKey: REVENUECAT_KEY,
      appUserID: appUserID ?? null,
    });
  } catch (err) {
    // Never crash the app if RC fails to configure — degrade gracefully.
    console.warn('[RevenueCat] configure failed:', err);
  }
}

/** Bind the RC customer to our authenticated FastAPI user_id (idempotent). */
export async function identifyRevenueCat(userId: string | null | undefined) {
  if (!isRevenueCatConfigured() || !userId) return;
  try {
    await Purchases.logIn(userId);
  } catch (err) {
    console.warn('[RevenueCat] logIn failed:', err);
  }
}

/** Return every package available in the current offering. */
export async function getAvailablePackages(): Promise<PurchasesPackage[]> {
  if (!isRevenueCatConfigured()) return [];
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current?.availablePackages ?? [];
  } catch (err) {
    console.warn('[RevenueCat] getOfferings failed:', err);
    return [];
  }
}

/** Look up a specific package by its Google Play product identifier. */
export function findPackageByProductId(
  packages: PurchasesPackage[],
  productId: string,
): PurchasesPackage | undefined {
  return packages.find(pkg => pkg.product.identifier === productId);
}

/** Look up the Pro (one-time) package. */
export function findProPackage(packages: PurchasesPackage[]): PurchasesPackage | undefined {
  // The Pro one-time can be exposed as a LIFETIME package OR simply by product id.
  return packages.find(pkg => pkg.product.identifier === PRODUCT_IDS.pro)
      || packages.find(pkg => pkg.packageType === PACKAGE_TYPE.LIFETIME);
}

/** Look up the Pro+ subscription package for the given interval. */
export function findProPlusPackage(
  packages: PurchasesPackage[],
  interval: ProPlusInterval,
): PurchasesPackage | undefined {
  const wanted = interval === 'annual' ? PACKAGE_TYPE.ANNUAL : PACKAGE_TYPE.MONTHLY;
  // First try package type match (standard RC convention).
  const byType = packages.find(pkg => pkg.packageType === wanted);
  if (byType) return byType;
  // Fallback: some setups expose subscription base plans as distinct product ids
  // like "pro_plus_subscription:monthly" — do a soft match.
  const needle = interval;
  return packages.find(pkg => {
    const id = pkg.product.identifier.toLowerCase();
    return id.includes('pro_plus') && id.includes(needle);
  });
}

/** True if the customer has the given entitlement currently active. */
export function hasEntitlement(info: CustomerInfo | null, id: EntitlementKey): boolean {
  return !!info?.entitlements?.active?.[id]?.isActive;
}

/**
 * Trigger a purchase for a single package. Callers must catch the returned
 * error and inspect `e.userCancelled` — a cancellation is not a real error.
 */
export async function buyPackage(pkg: PurchasesPackage): Promise<CustomerInfo> {
  if (!isRevenueCatConfigured()) {
    throw new Error('RevenueCat non configurato');
  }
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

/** Restore any previous non-consumable purchases attached to the Play account. */
export async function restorePurchases(): Promise<CustomerInfo | null> {
  if (!isRevenueCatConfigured()) return null;
  try {
    return await Purchases.restorePurchases();
  } catch (err) {
    console.warn('[RevenueCat] restore failed:', err);
    throw err;
  }
}

/** Get the current CustomerInfo (cached, fast). */
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!isRevenueCatConfigured()) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch (err) {
    console.warn('[RevenueCat] getCustomerInfo failed:', err);
    return null;
  }
}
