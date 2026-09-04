import { View, Text, StyleSheet, Pressable, Modal, ScrollView } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import { useState, PropsWithChildren } from 'react';
import { theme } from './theme';
import { useAuth } from './auth';
import { useTranslation } from './i18n';

/** Whether the currently-signed-in user has the Pro entitlement. */
export function useIsPro(): boolean {
  const { user } = useAuth();
  return !!(user && (user as any).is_pro);
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
            <View style={styles.priceBadge}>
              <Text style={styles.priceBadgeTxt}>{t('pro.price')}</Text>
            </View>
            <Text style={styles.mTitle}>{t('pro.upsell.title')}</Text>
            <Text style={styles.mSub}>{t('pro.upsell.sub')}</Text>
            <ProFeatureRow icon="camera" title={t('pro.feat.photos.t')} body={t('pro.feat.photos.b')} />
            <ProFeatureRow icon="package" title={t('pro.feat.fridge.t')} body={t('pro.feat.fridge.b')} />
            <ProFeatureRow icon="clock" title={t('pro.feat.expiry.t')} body={t('pro.feat.expiry.b')} />
            <ProFeatureRow icon="cloud" title={t('pro.feat.freezer.t')} body={t('pro.feat.freezer.b')} />
            <ProFeatureRow icon="upload-cloud" title={t('pro.feat.backup.t')} body={t('pro.feat.backup.b')} />
            <Pressable onPress={onClose} style={styles.mCta} testID="pro-upsell-cta">
              <Feather name="star" size={16} color="#fff" />
              <Text style={styles.mCtaTxt}>{t('pro.cta')}</Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.mLater} testID="pro-upsell-later">
              <Text style={styles.mLaterTxt}>{t('pro.later')}</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ProFeatureRow({ icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <View style={styles.featRow}>
      <View style={styles.featIcon}>
        <Feather name={icon} size={16} color={theme.color.brandPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.featT}>{title}</Text>
        <Text style={styles.featB}>{body}</Text>
      </View>
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
});
