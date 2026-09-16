import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { useTranslation } from '@/src/i18n';
import { weekStartOptions } from '@/src/week';
import { PrefsScreenShell } from '@/src/PrefsScreenShell';

export default function WeekStartPreference() {
  const { t, lang } = useTranslation();
  const { prefs, updatePreferences } = useAuth();
  const [weekStart, setWeekStart] = useState<number>(prefs.week_start_day);
  const OPTS = weekStartOptions(lang);
  useEffect(() => setWeekStart(prefs.week_start_day), [prefs.week_start_day]);

  return (
    <PrefsScreenShell
      title={t('prefs.weekStart.h')}
      dirty={weekStart !== prefs.week_start_day}
      onSave={() => updatePreferences({ week_start_day: weekStart })}
      testID="prefs-week-start"
    >
      <View style={s.section}>
        <Text style={s.sectionSub}>{t('prefs.weekStart.sub')}</Text>
        <View style={styles.grid}>
          {OPTS.map(o => {
            const active = weekStart === o.value;
            return (
              <Pressable
                key={o.value}
                onPress={() => { Haptics.selectionAsync(); setWeekStart(o.value); }}
                style={[styles.chip, active && styles.chipActive]}
                testID={`day-chip-${o.value}`}
              >
                <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </PrefsScreenShell>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: theme.spacing.sm },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
  },
  chipActive: { backgroundColor: theme.color.brandTertiary, borderColor: theme.color.brandPrimary },
  chipTxt: { fontSize: 14, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  chipTxtActive: { color: theme.color.brandPrimary, fontWeight: '600' },
});
