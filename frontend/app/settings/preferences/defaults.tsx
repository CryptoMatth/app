import { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAuth, DefaultsPrefs } from '@/src/auth';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { useTranslation } from '@/src/i18n';
import { PrefsScreenShell } from '@/src/PrefsScreenShell';

const DEFAULT = { default_qty: 1, default_unit: 'pz', default_servings: 2 };
const UNITS = ['g', 'kg', 'ml', 'l', 'pz', 'cucchiaio', 'cucchiaino'];
const SERVINGS = [1, 2, 3, 4, 6, 8];

export default function DefaultsPreference() {
  const { t } = useTranslation();
  const { prefs, updatePreferences } = useAuth();
  const [defaults, setDefaults] = useState<DefaultsPrefs>(prefs.defaults || DEFAULT);
  useEffect(() => setDefaults(prefs.defaults || DEFAULT), [prefs.defaults]);

  const dirty = useMemo(() => {
    const cur = prefs.defaults || DEFAULT;
    return cur.default_qty !== defaults.default_qty
      || cur.default_unit !== defaults.default_unit
      || cur.default_servings !== defaults.default_servings;
  }, [defaults, prefs.defaults]);

  return (
    <PrefsScreenShell
      title={t('prefs.defaults.h')}
      dirty={dirty}
      onSave={() => updatePreferences({ defaults })}
      testID="prefs-defaults"
    >
      <View style={s.section}>
        <Text style={s.sectionSub}>{t('prefs.defaults.sub')}</Text>

        <Text style={styles.subLabel}>{t('prefs.defaults.qty')}</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextInput
            value={String(defaults.default_qty)}
            onChangeText={(text) => {
              const v = parseFloat(text.replace(',', '.'));
              setDefaults(d => ({ ...d, default_qty: isNaN(v) ? 0 : v }));
            }}
            keyboardType="numeric"
            maxLength={6}
            style={[s.input, { flex: 1 }]}
            testID="def-qty"
          />
          <View style={{ flex: 1 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {UNITS.map(u => {
                const active = defaults.default_unit === u;
                return (
                  <Pressable
                    key={u}
                    onPress={() => { Haptics.selectionAsync(); setDefaults(d => ({ ...d, default_unit: u })); }}
                    style={[styles.chip, active && styles.chipActive]}
                    testID={`def-unit-${u}`}
                  >
                    <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{u}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>

        <Text style={styles.subLabel}>{t('prefs.defaults.servings')}</Text>
        <View style={styles.chipsRow}>
          {SERVINGS.map(n => {
            const active = defaults.default_servings === n;
            return (
              <Pressable
                key={n}
                onPress={() => { Haptics.selectionAsync(); setDefaults(d => ({ ...d, default_servings: n })); }}
                style={[styles.chip, active && styles.chipActive]}
                testID={`def-servings-${n}`}
              >
                <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{n}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </PrefsScreenShell>
  );
}

const styles = StyleSheet.create({
  subLabel: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.md, marginBottom: 6, fontWeight: '500' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  chipActive: { backgroundColor: theme.color.brandTertiary, borderColor: theme.color.brandPrimary },
  chipTxt: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  chipTxtActive: { color: theme.color.brandPrimary, fontWeight: '600' },
});
