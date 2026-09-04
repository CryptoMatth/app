import { View, Text, StyleSheet, Pressable, Modal, ScrollView } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import { useState, PropsWithChildren } from 'react';
import { theme } from './theme';
import { useAuth } from './auth';
import { useTranslation } from './i18n';

/** Whether the currently-signed-in user has any paid tier entitlement. */
export function useIsPro(): boolean {
  const { user } = useAuth();
  return !!(user && (user as any).is_pro);
}

export type Tier = 'free' | 'pro' | 'pro_plus' | 'ultra';
const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, pro_plus: 2, ultra: 3 };

/** Return the highest tier active for the current user. */
export function useTier(): Tier {
  const { user } = useAuth();
  const t = ((user as any)?.tier || 'free') as Tier;
  return TIER_RANK[t] === undefined ? 'free' : t;
}

/** Check whether the user has at least a given tier. */
export function useHasTier(min: Tier): boolean {
  const t = useTier();
  return TIER_RANK[t] >= TIER_RANK[min];
}

/** Wrapper that shows an overlay lock on top of its children when the user is not Pro.
 *  When locked, tapping anywhere opens a "Sblocca Pro" modal.
 *  Children still render visually beneath, so users get a preview of the feature.
 */
export function ProGate({
  children,
  feature,
  compact = false,
}: PropsWithChildren<{ feature: string; compact?: boolean }>) {
  const isPro = useIsPro();
  const [open, setOpen] = useState(false);
  if (isPro) return <>{children}</>;
  return (
    <View style={{ position: 'relative' }}>
      <View pointerEvents="none" style={{ opacity: 0.55 }}>
        {children}
      </View>
      <Pressable
        onPress={() => setOpen(true)}
        style={compact ? styles.overlayCompact : styles.overlay}
        testID={`pro-lock-${feature}`}
      >
        <View style={compact ? styles.badgeCompact : styles.badge}>
          <Feather name="lock" size={compact ? 12 : 14} color="#fff" />
          {!compact && <Text style={styles.badgeTxt}>PRO</Text>}
        </View>
      </Pressable>
      <ProUpsellModal open={open} onClose={() => setOpen(false)} feature={feature} />
    </View>
  );
}

/** Small inline badge for Pro features — use inside a row/header when we
 *  can't overlay content (e.g. "Aggiungi foto" button label). */
export function ProBadge({ testID }: { testID?: string }) {
  return (
    <View style={styles.badgeSmall} testID={testID}>
      <Feather name="lock" size={9} color="#fff" />
      <Text style={styles.badgeSmallTxt}>PRO</Text>
    </View>
  );
}

/** Modal explaining Pro features + upsell CTA. */
export function ProUpsellModal({ open, onClose, feature }: {
  open: boolean; onClose: () => void; feature?: string;
}) {
  const { t } = useTranslation();
  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.mOverlay} onPress={onClose}>
        <Pressable style={styles.mCardWrap} onPress={e => e.stopPropagation?.()}>
          <ScrollView
            style={styles.mCardScroll}
            contentContainerStyle={styles.mCard}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.mIcon}>
              <Feather name="star" size={26} color={theme.color.brand} />
            </View>
            <Text style={styles.mTitle}>{t('pro.upsell.title')}</Text>
            <Text style={styles.mSub}>{t('pro.upsell.sub')}</Text>

            <TierCard
              name={t('pro.tier.pro.name')} price={t('pro.tier.pro.price')} accent={theme.color.brand}
              features={[
                { icon: 'camera', label: t('pro.feat.photos.t') },
                { icon: 'image', label: t('pro.feat.photos_ing.t') },
                { icon: 'shopping-cart', label: t('pro.feat.photos_shop.t') },
                { icon: 'award', label: t('pro.feat.symbols.t') },
                { icon: 'tag', label: t('pro.feat.categories.t') },
              ]}
            />
            <TierCard
              name={t('pro.tier.proplus.name')} price={t('pro.tier.proplus.price')} accent={theme.color.brandSecondary}
              features={[
                { icon: 'clock', label: t('pro.feat.expiry.t') },
                { icon: 'cloud-snow', label: t('pro.feat.freezer.t') },
                { icon: 'package', label: t('pro.feat.fridge.t') },
              ]}
              note={t('pro.tier.includes', { plan: t('pro.tier.pro.name') })}
            />
            <TierCard
              name={t('pro.tier.ultra.name')} price={t('pro.tier.ultra.price')} accent="#8B6F47"
              features={[
                { icon: 'cloud', label: t('pro.feat.cloud_login.t') },
                { icon: 'upload-cloud', label: t('pro.feat.backup.t') },
              ]}
              note={t('pro.tier.includes', { plan: t('pro.tier.proplus.name') })}
              badgeLabel={t('pro.tier.comingSoon')}
            />

            <Pressable onPress={onClose} style={styles.mLater} testID="pro-upsell-later">
              <Text style={styles.mLaterTxt}>{t('pro.later')}</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TierCard({
  name, price, accent, features, note, badgeLabel,
}: {
  name: string; price: string; accent: string; features: { icon: any; label: string }[];
  note?: string; badgeLabel?: string;
}) {
  return (
    <View style={[styles.tierCard, { borderColor: accent }]}>
      <View style={styles.tierHead}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.tierName, { color: accent }]}>{name}</Text>
          <Text style={styles.tierPrice}>{price}</Text>
        </View>
        {badgeLabel ? (
          <View style={[styles.tierBadge, { backgroundColor: accent }]}>
            <Text style={styles.tierBadgeTxt}>{badgeLabel}</Text>
          </View>
        ) : null}
      </View>
      {features.map((f, i) => (
        <View key={i} style={styles.tierFeatRow}>
          <Feather name={f.icon} size={13} color={accent} />
          <Text style={styles.tierFeatTxt}>{f.label}</Text>
        </View>
      ))}
      {note ? <Text style={styles.tierNote}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  overlayCompact: {
    position: 'absolute', top: 6, right: 6,
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.brand,
  },
  badgeCompact: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: theme.color.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeTxt: { color: '#fff', fontWeight: '700', fontSize: 11, letterSpacing: 0.4 },
  badgeSmall: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: theme.color.brand,
  },
  badgeSmallTxt: { color: '#fff', fontWeight: '700', fontSize: 9, letterSpacing: 0.4 },
  mOverlay: { flex: 1, backgroundColor: 'rgba(44,40,38,0.55)', alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  mCardWrap: {
    width: '100%', maxWidth: 380, maxHeight: '90%',
    borderRadius: theme.radius.lg, backgroundColor: theme.color.surface,
    borderWidth: 1, borderColor: theme.color.border, overflow: 'hidden',
  },
  mCardScroll: { flexGrow: 0 },
  mCard: { padding: theme.spacing.xl },
  mIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#F5E8D8', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', marginBottom: theme.spacing.md },
  priceBadge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.color.brand,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: theme.radius.pill,
    marginBottom: 8,
  },
  priceBadgeTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  mTitle: { fontFamily: theme.font.display, fontSize: 20, color: theme.color.onSurface, marginBottom: 4 },
  mSub: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginBottom: theme.spacing.md, lineHeight: 18 },
  featRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  featIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  featT: { fontSize: 14, fontWeight: '600', color: theme.color.onSurface },
  featB: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 1, lineHeight: 16 },
  mCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: theme.color.brand, height: 48, borderRadius: theme.radius.pill, marginTop: theme.spacing.md },
  mCtaTxt: { color: '#fff', fontWeight: '600', fontSize: 15 },
  mLater: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  mLaterTxt: { color: theme.color.onSurfaceTertiary, fontSize: 13 },
  // Tier cards
  tierCard: {
    borderWidth: 1.5, borderRadius: theme.radius.md,
    padding: 14, marginTop: theme.spacing.md,
    backgroundColor: theme.color.surface,
  },
  tierHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  tierName: { fontFamily: theme.font.display, fontSize: 16, fontWeight: '700' },
  tierPrice: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2, fontWeight: '600' },
  tierBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  tierBadgeTxt: { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  tierFeatRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  tierFeatTxt: { fontSize: 13, color: theme.color.onSurface, flex: 1 },
  tierNote: {
    fontSize: 11, color: theme.color.onSurfaceTertiary, fontStyle: 'italic',
    marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: theme.color.divider,
  },
});
