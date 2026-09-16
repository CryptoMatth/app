/**
 * Piani PlanEat + Google Play Billing (via RevenueCat).
 *
 * Behaviour matrix:
 *   - Web / iOS / RC not configured → hide CTA buttons, show info banner.
 *   - user is free → show "Acquista Pro" + "Acquista Pro+" CTAs.
 *   - user is pro  → show "Aggiorna a Pro+ (€2)" CTA on the Pro+ card.
 *   - user is pro_plus → no CTAs, only badges.
 *   - always visible: "Ripristina acquisti" (unless RC not configured).
 */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Platform } from 'react-native';
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
  findPackageByProductId,
  getAvailablePackages,
  isRevenueCatConfigured,
  restorePurchases,
} from '@/src/purchases/revenueCat';

type Feature = { icon: any; label: string };
type Msg = { kind: 'ok' | 'err' | 'info'; text: string } | null;

export default function PlansScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const tier = useTier();
  const tierRank: Record<string, number> = { free: 0, pro: 1, pro_plus: 2 };
  const cur = tierRank[tier] ?? 0;

  const rcConfigured = isRevenueCatConfigured();

  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [busyProduct, setBusyProduct] = useState<string | null>(null);
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

  const handleBuy = useCallback(async (productId: string) => {
    if (!rcConfigured) {
      setMsg({ kind: 'info', text: t('plans.notConfigured') });
      return;
    }
    const pkg = findPackageByProductId(packages, productId);
    if (!pkg) {
      setMsg({ kind: 'err', text: t('plans.notConfigured') });
      return;
    }
    setBusyProduct(productId);
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
    setBusyProduct(null);
  }, [rcConfigured, packages, t, syncBackend]);

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

  // Compute which CTAs to expose. All hidden when RC not configured.
  const canBuyPro = rcConfigured && tier === 'free';
  const canBuyProPlus = rcConfigured && tier === 'free';
  const canUpgrade = rcConfigured && tier === 'pro';

  // Optional: display live prices returned by Play. Fallback to i18n copy.
  const priceFor = (productId: string): string | null => {
    const pkg = findPackageByProductId(packages, productId);
    return pkg?.product?.priceString || null;
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

        {/* Pro */}
        <PlanCard
          name={t('pro.tier.pro.name')}
          price={priceFor(PRODUCT_IDS.pro) || t('pro.tier.pro.price')}
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
            busy: busyProduct === PRODUCT_IDS.pro,
            onPress: () => handleBuy(PRODUCT_IDS.pro),
            testID: 'buy-pro',
          } : undefined}
        />

        {/* Pro+ */}
        <PlanCard
          name={t('pro.tier.proplus.name')}
          price={priceFor(canUpgrade ? PRODUCT_IDS.upgrade : PRODUCT_IDS.proPlus) || t('pro.tier.proplus.price')}
          accent={theme.color.brandSecondary}
          active={tier === 'pro_plus'}
          features={[
            { icon: 'tag', label: t('pro.feat.categories.t') },
            { icon: 'clock', label: t('pro.feat.expiry.t') },
            { icon: 'cloud-snow', label: t('pro.feat.freezer.t') },
            { icon: 'package', label: t('pro.feat.fridge.t') },
          ]}
          note={
            tier === 'pro'
              ? t('pro.tier.upgradeFromPro')
              : t('pro.tier.includes', { plan: t('pro.tier.pro.name') })
          }
          cta={
            canUpgrade ? {
              label: t('plans.upgradeToProPlus'),
              busy: busyProduct === PRODUCT_IDS.upgrade,
              onPress: () => handleBuy(PRODUCT_IDS.upgrade),
              testID: 'upgrade-pro-plus',
            } : canBuyProPlus ? {
              label: t('plans.buyProPlus'),
              busy: busyProduct === PRODUCT_IDS.proPlus,
              onPress: () => handleBuy(PRODUCT_IDS.proPlus),
              testID: 'buy-pro-plus',
            } : undefined
          }
        />

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
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------- Plan Card ----------------
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
});
