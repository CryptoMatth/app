/**
 * Piani Planibble + Google Play Billing (via RevenueCat).
 *
 * Behaviour matrix:
 *   - Web / iOS / RC not configured → hide CTA buttons, show info banner.
 *   - user is free       → show "Acquista Pro" + "Pro+ mensile" + "Pro+ annuale".
 *   - user is pro        → show only Pro+ subscription CTAs (both intervals).
 *   - user is pro_plus   → no CTAs, only badges.
 *   - always visible: "Ripristina acquisti" (unless RC not configured).
 */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import type { PurchasesPackage, CustomerInfo } from 'react-native-purchases';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { useTranslation } from '@/src/i18n';
import { useTier } from '@/src/ProGate';
import { useAuth } from '@/src/auth';
import { api } from '@/src/api';
import {
  PRODUCT_IDS,
  buyPackage,
  findProPackage,
  findProPlusPackage,
  getAvailablePackages,
  isRevenueCatConfigured,
  restorePurchases,
  type ProPlusInterval,
} from '@/src/purchases/revenueCat';

type Feature = { icon: any; label: string };
type Msg = { kind: 'ok' | 'err' | 'info'; text: string } | null;

/** Format an ISO datetime like "DD/MM/YYYY" using the current locale. Falls
 *  back silently to the raw string if parsing fails. */
function formatDate(iso?: string | null, _t?: (k: string) => string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString();
  } catch { return iso || ''; }
}

// Business-defined fallback prices (used when RevenueCat isn't reachable yet).
const FALLBACK_PRICE = {
  pro: '3€ una tantum',
  proPlusMonthly: '2€ / mese',
  proPlusAnnual: '20€ / anno',
} as const;

export default function PlansScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { refresh, user } = useAuth();
  const tier = useTier();
  const tierRank: Record<string, number> = { free: 0, pro: 1, pro_plus: 2 };
  const cur = tierRank[tier] ?? 0;

  const rcConfigured = isRevenueCatConfigured();

  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    if (!msg) return;
    const to = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(to);
  }, [msg]);

  useEffect(() => {
    if (!rcConfigured) return;
    (async () => {
      const pkgs = await getAvailablePackages();
      setPackages(pkgs);
    })();
  }, [rcConfigured]);

  const syncBackend = useCallback(async (info: CustomerInfo | null) => {
    if (!info) return;
    try {
      const active = Object.keys(info.entitlements?.active || {});
      await api.syncPurchases({
        revenuecat_app_user_id: info.originalAppUserId,
        entitlements: active,
      });
      await refresh();
    } catch {
      // The webhook is the authoritative source anyway — non-blocking.
    }
  }, [refresh]);

  const purchase = useCallback(async (
    key: string,
    pkg: PurchasesPackage | undefined,
  ) => {
    if (!rcConfigured) {
      setMsg({ kind: 'info', text: t('plans.notConfigured') });
      return;
    }
    if (!pkg) {
      setMsg({ kind: 'err', text: t('plans.notConfigured') });
      return;
    }
    setBusyKey(key);
    setMsg(null);
    try {
      Haptics.selectionAsync();
      const info = await buyPackage(pkg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMsg({ kind: 'ok', text: t('plans.purchaseSuccess') });
      await syncBackend(info);
    } catch (e: any) {
      if (e?.userCancelled) {
        setMsg({ kind: 'info', text: t('plans.purchaseCancelled') });
      } else {
        setMsg({ kind: 'err', text: e?.message || t('plans.purchaseFailed') });
      }
    }
    setBusyKey(null);
  }, [rcConfigured, t, syncBackend]);

  const handleRestore = useCallback(async () => {
    if (!rcConfigured) {
      setMsg({ kind: 'info', text: t('plans.notConfigured') });
      return;
    }
    setRestoring(true);
    setMsg(null);
    try {
      const info = await restorePurchases();
      const activeCount = info ? Object.keys(info.entitlements?.active || {}).length : 0;
      if (activeCount > 0) {
        setMsg({ kind: 'ok', text: t('plans.restoreSuccess') });
        await syncBackend(info);
      } else {
        setMsg({ kind: 'info', text: t('plans.restoreEmpty') });
      }
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || t('plans.restoreFailed') });
    }
    setRestoring(false);
  }, [rcConfigured, t, syncBackend]);

  // Package lookups
  const proPkg = findProPackage(packages);
  const proPlusMonthlyPkg = findProPlusPackage(packages, 'monthly');
  const proPlusAnnualPkg = findProPlusPackage(packages, 'annual');

  // Compute which CTAs to expose. Hidden when RC not configured.
  const canBuyPro = rcConfigured && tier === 'free';
  const canSubscribeProPlus = rcConfigured && (tier === 'free' || tier === 'pro');

  // Display prices — we always show the business-defined fallback price in
  // the hero / card labels because the Play Store price can diverge due to
  // currency conversion and may confuse users (B2 fix). The real transaction
  // price is shown by Google Play at the checkout screen anyway.
  //
  // Keep a `_rawPrice` helper around in case we ever want to surface the Play
  // price as a secondary line.
  const priceOr = (_pkg: PurchasesPackage | undefined, fallback: string) => fallback;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _rawPrice = (pkg: PurchasesPackage | undefined, fallback: string) =>
    pkg?.product?.priceString || fallback;

  // Estimated per-month equivalent for the annual plan — business copy only
  // (we no longer compute from Play price to avoid locale/currency surprises;
  // 20€/anno ÷ 12 ≈ 1,67€/mese).
  const perMonthFromAnnual = (_annual: PurchasesPackage | undefined): string | null => {
    return t('plans.proPlus.annualEquivalent');
  };

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="plans-screen">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back} testID="plans-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={s.h1}>{t('plans.header')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Feather name="award" size={22} color={theme.color.brand} />
          </View>
          <Text style={styles.heroTitle}>{t('plans.title')}</Text>
          <Text style={styles.heroSub}>{t('plans.subtitle')}</Text>
        </View>

        {/* Platform / config notice */}
        {!rcConfigured && (
          <View style={styles.infoBanner} testID="plans-info-banner">
            <Feather name="info" size={14} color={theme.color.brand} />
            <Text style={styles.infoBannerTxt}>
              {Platform.OS !== 'android' ? t('plans.notAndroid') : t('plans.notConfigured')}
            </Text>
          </View>
        )}

        {/* Free */}
        <PlanCard
          name={t('plans.free.name')} price={t('plans.free.price')} accent={theme.color.onSurfaceSecondary}
          active={tier === 'free'}
          locked={cur >= tierRank.free && tier !== 'free'}
          features={[
            { icon: 'book', label: t('plans.free.f1') },
            { icon: 'calendar', label: t('plans.free.f2') },
          ]}
        />

        {/* Pro — ONE-TIME */}
        <PlanCard
          name={t('pro.tier.pro.name')}
          price={priceOr(proPkg, FALLBACK_PRICE.pro)}
          accent={theme.color.brand}
          active={tier === 'pro'}
          locked={cur >= tierRank.pro && tier !== 'pro'}
          features={[
            { icon: 'camera', label: t('pro.feat.photos.t') },
            { icon: 'image', label: t('pro.feat.photos_ing.t') },
            { icon: 'award', label: t('pro.feat.symbols.t') },
          ]}
          cta={canBuyPro ? {
            label: t('plans.buyPro'),
            busy: busyKey === 'pro',
            onPress: () => purchase('pro', proPkg),
            testID: 'buy-pro',
          } : undefined}
        />

        {/* Pro+ — SUBSCRIPTION with TWO intervals */}
        <View style={[
          styles.card,
          { borderColor: theme.color.brandSecondary },
          tier === 'pro_plus' && { borderWidth: 2.5 },
          cur > tierRank.pro_plus && { opacity: 0.55 },
        ]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[styles.name, { color: theme.color.brandSecondary }]}>
                  {t('pro.tier.proplus.name')}
                </Text>
                {tier === 'pro_plus' ? (
                  <View style={[styles.activeBadge, { backgroundColor: theme.color.brandSecondary }]}>
                    <Feather name="check" size={11} color="#fff" />
                  </View>
                ) : null}
              </View>
              <Text style={styles.price}>{t('plans.proPlus.pricingSummary')}</Text>
            </View>
          </View>

          {[
            { icon: 'tag', label: t('pro.feat.categories.t') },
            { icon: 'clock', label: t('pro.feat.expiry.t') },
            { icon: 'cloud-snow', label: t('pro.feat.freezer.t') },
            { icon: 'package', label: t('pro.feat.fridge.t') },
            { icon: 'shield-off', label: t('pro.feat.noads.t') },
          ].map((f, i) => (
            <View key={i} style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: `${theme.color.brandSecondary}22` }]}>
                <Feather name={f.icon as any} size={13} color={theme.color.brandSecondary} />
              </View>
              <Text style={styles.rowTxt}>{f.label}</Text>
            </View>
          ))}

          {tier === 'pro' && (
            <Text style={styles.note}>{t('pro.tier.upgradeFromPro')}</Text>
          )}

          {/* Two subscription CTAs side by side */}
          {canSubscribeProPlus && (
            <View style={styles.subsRow}>
              {/* Monthly */}
              <Pressable
                onPress={() => purchase('proplus_monthly', proPlusMonthlyPkg)}
                disabled={busyKey === 'proplus_monthly'}
                style={[
                  styles.subCard,
                  { borderColor: theme.color.brandSecondary },
                  busyKey === 'proplus_monthly' && { opacity: 0.6 },
                ]}
                testID="buy-pro-plus-monthly"
              >
                <Text style={styles.subLabel}>{t('plans.proPlus.monthly')}</Text>
                <Text style={[styles.subPrice, { color: theme.color.brandSecondary }]}>
                  {priceOr(proPlusMonthlyPkg, FALLBACK_PRICE.proPlusMonthly)}
                </Text>
                <View style={[styles.subCta, { backgroundColor: theme.color.brandSecondary }]}>
                  {busyKey === 'proplus_monthly'
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.subCtaTxt}>{t('plans.subscribe')}</Text>}
                </View>
              </Pressable>

              {/* Annual — highlighted as "Best value" */}
              <Pressable
                onPress={() => purchase('proplus_annual', proPlusAnnualPkg)}
                disabled={busyKey === 'proplus_annual'}
                style={[
                  styles.subCard,
                  styles.subCardBest,
                  busyKey === 'proplus_annual' && { opacity: 0.6 },
                ]}
                testID="buy-pro-plus-annual"
              >
                <View style={styles.bestPill}>
                  <Text style={styles.bestPillTxt}>{t('plans.bestValue')}</Text>
                </View>
                <Text style={styles.subLabel}>{t('plans.proPlus.annual')}</Text>
                <Text style={[styles.subPrice, { color: theme.color.brandSecondary }]}>
                  {priceOr(proPlusAnnualPkg, FALLBACK_PRICE.proPlusAnnual)}
                </Text>
                <Text style={styles.subEquiv}>{perMonthFromAnnual(proPlusAnnualPkg)}</Text>
                <View style={[styles.subCta, { backgroundColor: theme.color.brandSecondary }]}>
                  {busyKey === 'proplus_annual'
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.subCtaTxt}>{t('plans.subscribe')}</Text>}
                </View>
              </Pressable>
            </View>
          )}

          {tier === 'pro_plus' && (
            <>
              <View style={styles.activeInfo}>
                <Feather name="check-circle" size={14} color={theme.color.success} />
                <Text style={styles.activeInfoTxt}>
                  {user?.pro_plus_expires_at
                    ? (user.pro_plus_will_renew === false
                        ? t('plans.proPlus.endingOn', { date: formatDate(user.pro_plus_expires_at, t) })
                        : t('plans.proPlus.renewOn', { date: formatDate(user.pro_plus_expires_at, t) }))
                    : t('plans.proPlus.activeInfo')}
                </Text>
              </View>

              {/* D1/D2 — "Gestisci abbonamento" opens Google Play subscriptions page. */}
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  const url = Platform.OS === 'android'
                    ? 'https://play.google.com/store/account/subscriptions?sku=pro_plus_subscription&package=com.emergent.mealprepmaster.op32ei'
                    : 'https://play.google.com/store/account/subscriptions';
                  Linking.openURL(url).catch(() => {});
                }}
                style={styles.manageBtn}
                testID="manage-subscription"
              >
                <Feather name="external-link" size={14} color={theme.color.brandPrimary} />
                <Text style={styles.manageBtnTxt}>{t('plans.manageSubscription')}</Text>
              </Pressable>
            </>
          )}
        </View>

        {/* Restore purchases */}
        {rcConfigured && (
          <Pressable
            onPress={handleRestore}
            disabled={restoring}
            style={styles.restoreBtn}
            testID="restore-purchases"
          >
            {restoring ? (
              <ActivityIndicator size="small" color={theme.color.brand} />
            ) : (
              <Feather name="refresh-cw" size={14} color={theme.color.brand} />
            )}
            <Text style={styles.restoreTxt}>
              {restoring ? t('plans.restoring') : t('plans.restorePurchases')}
            </Text>
          </Pressable>
        )}

        {/* Feedback message */}
        {msg && (
          <View
            style={[
              styles.msgBox,
              msg.kind === 'err' && styles.msgErr,
              msg.kind === 'ok' && styles.msgOk,
              msg.kind === 'info' && styles.msgInfo,
            ]}
            testID="plans-msg"
          >
            <Feather
              name={msg.kind === 'err' ? 'alert-circle' : msg.kind === 'ok' ? 'check-circle' : 'info'}
              size={14}
              color={
                msg.kind === 'err' ? theme.color.error :
                  msg.kind === 'ok' ? theme.color.success : theme.color.brand
              }
            />
            <Text style={[
              styles.msgTxt,
              { color: msg.kind === 'err' ? theme.color.error : msg.kind === 'ok' ? theme.color.success : theme.color.brand },
            ]}>{msg.text}</Text>
          </View>
        )}

        <Text style={styles.footer}>{t('plans.footer')}</Text>
        <Text style={styles.footerSmall}>{t('plans.subFooter')}</Text>
        <Text style={styles.footerSmall}>{t('plans.priceDisclaimer')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------- Plan Card (used for Free & Pro one-time) ----------------
type CTA = { label: string; busy: boolean; onPress: () => void; testID?: string };

function PlanCard({
  name, price, accent, features, note, active, badge, locked, cta,
}: {
  name: string; price: string; accent: string; features: Feature[];
  note?: string; active?: boolean; badge?: string; locked?: boolean; cta?: CTA;
}) {
  return (
    <View style={[
      styles.card,
      { borderColor: accent },
      active && { borderWidth: 2.5 },
      locked && !active && { opacity: 0.55 },
    ]}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.name, { color: accent }]}>{name}</Text>
            {active ? (
              <View style={[styles.activeBadge, { backgroundColor: accent }]}>
                <Feather name="check" size={11} color="#fff" />
              </View>
            ) : null}
          </View>
          <Text style={styles.price}>{price}</Text>
        </View>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: accent }]}>
            <Text style={styles.badgeTxt}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {features.map((f, i) => (
        <View key={i} style={styles.row}>
          <View style={[styles.rowIcon, { backgroundColor: `${accent}22` }]}>
            <Feather name={f.icon} size={13} color={accent} />
          </View>
          <Text style={styles.rowTxt}>{f.label}</Text>
        </View>
      ))}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {cta && (
        <Pressable
          onPress={cta.onPress}
          disabled={cta.busy}
          style={[styles.buyBtn, { backgroundColor: accent }, cta.busy && { opacity: 0.6 }]}
          testID={cta.testID}
        >
          {cta.busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Feather name="shopping-bag" size={14} color="#fff" />
              <Text style={styles.buyBtnTxt}>{cta.label}</Text>
            </>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'flex-start', marginBottom: theme.spacing.lg },
  heroIcon: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#F5E8D8',
    alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md,
  },
  heroTitle: { fontFamily: theme.font.display, fontSize: 22, color: theme.color.onSurface },
  heroSub: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 4, lineHeight: 18 },
  card: {
    borderWidth: 1.5, borderRadius: theme.radius.md,
    padding: 14, marginBottom: theme.spacing.md,
    backgroundColor: theme.color.surface,
  },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  name: { fontFamily: theme.font.display, fontSize: 17, fontWeight: '700' },
  price: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2, fontWeight: '600' },
  activeBadge: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeTxt: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  rowIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTxt: { fontSize: 13, color: theme.color.onSurface, flex: 1 },
  note: {
    fontSize: 11, color: theme.color.onSurfaceTertiary, fontStyle: 'italic',
    marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: theme.color.divider,
  },
  buyBtn: {
    marginTop: 12, height: 42, borderRadius: theme.radius.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  buyBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  restoreBtn: {
    marginTop: 8, marginBottom: 8, padding: 12, borderRadius: theme.radius.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: theme.color.brand, borderStyle: 'dashed',
    alignSelf: 'center', paddingHorizontal: 20,
  },
  restoreTxt: { color: theme.color.brand, fontWeight: '600', fontSize: 13 },
  infoBanner: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    padding: 12, marginBottom: theme.spacing.md,
    borderRadius: theme.radius.md, backgroundColor: '#FDE2CE',
    borderWidth: 1, borderColor: theme.color.brand,
  },
  infoBannerTxt: { flex: 1, fontSize: 12, color: theme.color.brand, lineHeight: 16 },
  msgBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: theme.radius.md, marginTop: theme.spacing.sm,
  },
  msgErr: { backgroundColor: '#F5E0DC' },
  msgOk: { backgroundColor: '#E5EDDF' },
  msgInfo: { backgroundColor: '#FDE2CE' },
  msgTxt: { fontSize: 12, fontWeight: '600', flex: 1 },
  footer: {
    fontSize: 11, color: theme.color.onSurfaceTertiary, textAlign: 'center',
    marginTop: theme.spacing.md, fontStyle: 'italic', lineHeight: 16,
  },
  footerSmall: {
    fontSize: 10, color: theme.color.onSurfaceTertiary, textAlign: 'center',
    marginTop: 6, lineHeight: 14,
  },

  // Subscription two-card row
  subsRow: {
    flexDirection: 'row', gap: 10, marginTop: 12,
  },
  subCard: {
    flex: 1, borderRadius: theme.radius.md, borderWidth: 1.5,
    padding: 12, backgroundColor: theme.color.surface,
    alignItems: 'center', gap: 4,
    position: 'relative',
  },
  subCardBest: {
    borderColor: theme.color.brandSecondary,
    backgroundColor: '#F1F5EB',
  },
  subLabel: { fontSize: 12, fontWeight: '600', color: theme.color.onSurfaceSecondary },
  subPrice: { fontSize: 16, fontWeight: '800' },
  subEquiv: { fontSize: 10, color: theme.color.onSurfaceTertiary, fontStyle: 'italic' },
  subCta: {
    marginTop: 8, alignSelf: 'stretch', height: 36, borderRadius: theme.radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  subCtaTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  bestPill: {
    position: 'absolute', top: -9, right: 8,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
    backgroundColor: theme.color.brandSecondary,
  },
  bestPillTxt: { color: '#fff', fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
  activeInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 12, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: theme.color.divider,
  },
  activeInfoTxt: { fontSize: 12, color: theme.color.success, fontWeight: '600', flex: 1 },
  manageBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 10, paddingVertical: 11,
    borderRadius: theme.radius.md, borderWidth: 1, borderStyle: 'dashed',
    borderColor: theme.color.brandPrimary,
  },
  manageBtnTxt: { color: theme.color.brandPrimary, fontWeight: '700', fontSize: 13 },
});
