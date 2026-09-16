/**
 * RevenueCat client wrapper — Android only for now.
 *
 * Guards every native call with:
 *   1. Platform.OS === 'android'  (web/iOS silently no-op)
 *   2. isRevenueCatConfigured()   (missing/empty API key → no-op)
 *
 * All product IDs match the ones set up in Google Play Console and mapped to
 * RevenueCat entitlements in the dashboard:
 *
 *   pro_lifetime           → entitlement "pro"
 *   pro_plus_lifetime      → entitlement "pro_plus"
 *   pro_to_pro_plus_upgrade → entitlement "pro_plus"
 */
import { Platform } from 'react-native';
import Purchases, {
  CustomerInfo,
  LOG_LEVEL,
  PurchasesPackage,
} from 'react-native-purchases';

export const REVENUECAT_KEY = process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY?.trim() || '';

export const PRODUCT_IDS = {
  pro: 'pro_lifetime',
  proPlus: 'pro_plus_lifetime',
  upgrade: 'pro_to_pro_plus_upgrade',
} as const;

export type EntitlementKey = 'pro' | 'pro_plus';

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
