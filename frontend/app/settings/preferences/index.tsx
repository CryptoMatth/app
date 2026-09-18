/**
 * Preferences Hub — mirrors the Settings hub layout.
 * Sections: Generale · Categorie · Notifiche (with master toggle).
 * Each row navigates to a dedicated editor screen.
 */
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { useTranslation } from '@/src/i18n';
import { useHasTier, ProUpsellModal } from '@/src/ProGate';
import { readNotifPrefs } from '@/src/notifications';

type Row = {
  key: string;
  href?: any;
  onPress?: () => void;
  icon: keyof typeof Feather.glyphMap;
  emoji?: string;
  bg?: string;
  color?: string;
  title: string;
  sub: string;
  locked?: boolean;
  testID?: string;
};

export default function PreferencesHub() {
  const router = useRouter();
  const { t, lang } = useTranslation();
  const { prefs } = useAuth();
  const isProPlus = useHasTier('pro_plus');
  const [upsell, setUpsell] = useState(false);

  // Read effective on/off state through the shared readNotifPrefs helper so
  // the UI matches what the scheduler actually sees.
  const effective = readNotifPrefs(prefs);
  const expiryOn = effective.expiry_enabled;
  const freezerOn = effective.freezer_enabled;
  const languageLabel = prefs.language === 'en' ? '🇬🇧  English' : '🇮🇹  Italiano';  const weekLabels = lang === 'it'
    ? ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekStartLabel = weekLabels[prefs.week_start_day] || weekLabels[1];
  const spanLabel = prefs.planner_span === 'biweekly'
    ? t('prefs.span.biweekly') + ' · ' + t('prefs.span.biweeklySub')
    : t('prefs.span.weekly') + ' · ' + t('prefs.span.weeklySub');
  const defaults = prefs.defaults || { default_qty: 1, default_unit: 'pz', default_servings: 2 };
  const defaultsLabel = `${defaults.default_qty} ${defaults.default_unit} · ${defaults.default_servings} ${lang === 'it' ? 'coperti' : 'servings'}`;

  const toggleNotifications = () => {
    if (!isProPlus) { setUpsell(true); }
  };
  void toggleNotifications;


  const sections: { title: string; rows: Row[] }[] = [
    {
      title: t('prefs.section.general'),
      rows: [
        {
          key: 'language',
          href: '/settings/preferences/language',
          icon: 'globe',
          bg: theme.color.brandTertiary,
          color: theme.color.brandPrimary,
          title: t('prefs.language.h'),
          sub: languageLabel,
          testID: 'nav-prefs-language',
        },
        {
          key: 'weekStart',
          href: '/settings/preferences/week-start',
          icon: 'calendar',
          bg: '#E5EDDF',
          color: theme.color.brandSecondary,
          title: t('prefs.weekStart.h'),
          sub: weekStartLabel,
          testID: 'nav-prefs-week-start',
        },
        {
          key: 'span',
          href: '/settings/preferences/planner-span',
          icon: 'columns',
          bg: '#F5E8D8',
          color: theme.color.brand,
          title: t('prefs.span.h'),
          sub: spanLabel,
          testID: 'nav-prefs-span',
        },
        {
          key: 'defaults',
          href: '/settings/preferences/defaults',
          icon: 'sliders',
          bg: theme.color.brandTertiary,
          color: theme.color.brandPrimary,
          title: t('prefs.defaults.h'),
          sub: defaultsLabel,
          testID: 'nav-prefs-defaults',
        },
      ],
    },
    {
      title: t('prefs.section.categories'),
      rows: [
        {
          key: 'courses',
          href: '/settings/preferences/courses',
          icon: 'tag',
          bg: '#E5EDDF',
          color: theme.color.brandSecondary,
          title: t('prefs.courses.h'),
          sub: `${prefs.courses.length} ${lang === 'it' ? 'categorie' : 'categories'}`,
          testID: 'nav-prefs-courses',
        },
        {
          key: 'ingCats',
          href: '/settings/preferences/ingredient-categories',
          icon: 'grid',
          bg: '#F5E8D8',
          color: theme.color.brand,
          title: t('prefs.ingCats.h'),
          sub: isProPlus
            ? `${prefs.ingredient_categories.length} ${lang === 'it' ? 'categorie' : 'categories'}`
            : (lang === 'it' ? 'Sblocca con Pro+' : 'Unlock with Pro+'),
          locked: !isProPlus,
          testID: 'nav-prefs-ing-cats',
        },
      ],
    },
    {
      title: t('prefs.section.notifications'),
      rows: [
        {
          key: 'expiry',
          href: '/settings/preferences/notifications-expiry',
          icon: 'clock',
          bg: theme.color.brandTertiary,
          color: theme.color.brandPrimary,
          title: t('notif.expiry.h'),
          sub: expiryOn ? t('prefs.notif.masterOn') : t('prefs.notif.masterOff'),
          locked: !isProPlus,
          testID: 'nav-prefs-notif-expiry',
        },
        {
          key: 'freezer',
          href: '/settings/preferences/notifications-freezer',
          icon: 'cloud-snow',
          bg: '#E5EDDF',
          color: theme.color.brandSecondary,
          title: t('notif.freezer.h'),
          sub: freezerOn ? t('prefs.notif.masterOn') : t('prefs.notif.masterOff'),
          locked: !isProPlus,
          testID: 'nav-prefs-notif-freezer',
        },
      ],
    },
  ];

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="preferences-hub">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back} testID="prefs-hub-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={s.h1}>{t('prefs.header')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}>
        {sections.map(sec => (
          <View key={sec.title} style={s.section}>
            <View style={hubStyles.secHead}>
              <Text style={s.sectionH}>{sec.title}</Text>
            </View>
            {sec.rows.map(r => (
              <Pressable
                key={r.key}
                onPress={() => {
                  if (r.locked) { setUpsell(true); return; }
                  if (r.href) router.push(r.href); else r.onPress?.();
                }}
                style={s.actionRow}
                testID={r.testID}
              >
                <View style={[s.actionIcon, { backgroundColor: r.bg || theme.color.brandTertiary }]}>
                  <Feather name={r.icon} size={18} color={r.color || theme.color.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={s.actionTitle}>{r.title}</Text>
                    {r.locked && (
                      <View style={hubStyles.proBadge}>
                        <Feather name="lock" size={9} color="#fff" />
                        <Text style={hubStyles.proBadgeTxt}>PRO+</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.actionSub}>{r.sub}</Text>
                </View>
                <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>

      <ProUpsellModal open={upsell} onClose={() => setUpsell(false)} feature="preferences" />
    </SafeAreaView>
  );
}

const hubStyles = StyleSheet.create({
  secHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  proBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10,
    backgroundColor: theme.color.brand,
  },
  proBadgeTxt: { color: '#fff', fontWeight: '700', fontSize: 9 },
  masterTxt: { fontSize: 11, color: theme.color.onSurfaceSecondary },
  switch: {
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: theme.color.borderStrong, padding: 3, justifyContent: 'center',
  },
  switchOn: { backgroundColor: theme.color.brandPrimary },
  thumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  thumbOn: { alignSelf: 'flex-end' },
});
