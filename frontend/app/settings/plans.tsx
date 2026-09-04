import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { useTranslation } from '@/src/i18n';
import { useTier } from '@/src/ProGate';

type Feature = { icon: any; label: string };

function PlanCard({
  name, price, accent, features, note, active, badge,
}: {
  name: string; price: string; accent: string; features: Feature[];
  note?: string; active?: boolean; badge?: string;
}) {
  return (
    <View style={[styles.card, { borderColor: accent }, active && { borderWidth: 2.5 }]}>
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
    </View>
  );
}

export default function PlansScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const tier = useTier();
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

        {/* Free */}
        <PlanCard
          name={t('plans.free.name')} price={t('plans.free.price')} accent={theme.color.onSurfaceSecondary}
          active={tier === 'free'}
          features={[
            { icon: 'book', label: t('plans.free.f1') },
            { icon: 'calendar', label: t('plans.free.f2') },
          ]}
        />

        {/* Pro */}
        <PlanCard
          name={t('pro.tier.pro.name')} price={t('pro.tier.pro.price')} accent={theme.color.brand}
          active={tier === 'pro'}
          features={[
            { icon: 'camera', label: t('pro.feat.photos.t') },
            { icon: 'image', label: t('pro.feat.photos_ing.t') },
            { icon: 'shopping-cart', label: t('pro.feat.photos_shop.t') },
            { icon: 'award', label: t('pro.feat.symbols.t') },
            { icon: 'tag', label: t('pro.feat.categories.t') },
          ]}
        />

        {/* Pro+ */}
        <PlanCard
          name={t('pro.tier.proplus.name')} price={t('pro.tier.proplus.price')} accent={theme.color.brandSecondary}
          active={tier === 'pro_plus'}
          features={[
            { icon: 'clock', label: t('pro.feat.expiry.t') },
            { icon: 'cloud-snow', label: t('pro.feat.freezer.t') },
            { icon: 'package', label: t('pro.feat.fridge.t') },
          ]}
          note={t('pro.tier.includes', { plan: t('pro.tier.pro.name') })}
        />

        {/* Ultra */}
        <PlanCard
          name={t('pro.tier.ultra.name')} price={t('pro.tier.ultra.price')} accent="#8B6F47"
          active={tier === 'ultra'}
          badge={t('pro.tier.comingSoon')}
          features={[
            { icon: 'cloud', label: t('pro.feat.cloud_login.t') },
            { icon: 'upload-cloud', label: t('pro.feat.backup.t') },
          ]}
          note={t('pro.tier.includes', { plan: t('pro.tier.proplus.name') })}
        />

        <Text style={styles.footer}>{t('plans.footer')}</Text>
      </ScrollView>
    </SafeAreaView>
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
  footer: {
    fontSize: 11, color: theme.color.onSurfaceTertiary, textAlign: 'center',
    marginTop: theme.spacing.md, fontStyle: 'italic', lineHeight: 16,
  },
});
