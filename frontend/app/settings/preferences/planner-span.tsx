import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { useTranslation } from '@/src/i18n';
import { PrefsScreenShell } from '@/src/PrefsScreenShell';

export default function PlannerSpanPreference() {
  const { t } = useTranslation();
  const { prefs, updatePreferences } = useAuth();
  const [span, setSpan] = useState<'weekly' | 'biweekly'>(prefs.planner_span);
  useEffect(() => setSpan(prefs.planner_span), [prefs.planner_span]);

  return (
    <PrefsScreenShell
      title={t('prefs.span.h')}
      dirty={span !== prefs.planner_span}
      onSave={() => updatePreferences({ planner_span: span })}
      testID="prefs-planner-span"
    >
      <View style={s.section}>
        <Text style={s.sectionSub}>{t('prefs.span.sub')}</Text>
        <View style={styles.row}>
          {([
            { key: 'weekly', label: t('prefs.span.weekly'), sub: t('prefs.span.weeklySub'), icon: 'calendar' as const },
            { key: 'biweekly', label: t('prefs.span.biweekly'), sub: t('prefs.span.biweeklySub'), icon: 'columns' as const },
          ]).map(o => {
            const active = span === o.key;
            return (
              <Pressable
                key={o.key}
                onPress={() => { Haptics.selectionAsync(); setSpan(o.key as any); }}
                style={[styles.card, active && styles.cardActive]}
                testID={`span-${o.key}`}
              >
                <View style={[styles.icon, active && { backgroundColor: theme.color.brandPrimary }]}>
                  <Feather name={o.icon} size={18} color={active ? '#fff' : theme.color.brandPrimary} />
                </View>
                <Text style={[styles.label, active && { color: theme.color.brandPrimary, fontWeight: '700' }]}>{o.label}</Text>
                <Text style={styles.sub}>{o.sub}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </PrefsScreenShell>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginTop: theme.spacing.sm },
  card: {
    flex: 1, padding: theme.spacing.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface,
    alignItems: 'flex-start', gap: 6,
  },
  cardActive: { borderColor: theme.color.brandPrimary, borderWidth: 2, backgroundColor: theme.color.brandTertiary },
  icon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: theme.color.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { fontSize: 14, color: theme.color.onSurface, fontWeight: '600' },
  sub: { fontSize: 11, color: theme.color.onSurfaceTertiary },
});
