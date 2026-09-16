import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { useTranslation } from '@/src/i18n';
import { PrefsScreenShell } from '@/src/PrefsScreenShell';

export default function LanguagePreference() {
  const { t } = useTranslation();
  const { prefs, updatePreferences } = useAuth();
  const [language, setLanguage] = useState<'it' | 'en'>(prefs.language);
  useEffect(() => setLanguage(prefs.language), [prefs.language]);

  return (
    <PrefsScreenShell
      title={t('prefs.language.h')}
      dirty={language !== prefs.language}
      onSave={() => updatePreferences({ language })}
      testID="prefs-language"
    >
      <View style={s.section}>
        <Text style={s.sectionSub}>{t('prefs.language.sub')}</Text>
        <View style={styles.row}>
          {[
            { key: 'it', label: '🇮🇹  Italiano' },
            { key: 'en', label: '🇬🇧  English' },
          ].map(o => {
            const active = language === o.key;
            return (
              <Pressable
                key={o.key}
                onPress={() => { Haptics.selectionAsync(); setLanguage(o.key as any); }}
                style={[styles.card, active && styles.cardActive]}
                testID={`lang-${o.key}`}
              >
                <Text style={[styles.txt, active && { color: theme.color.brandPrimary, fontWeight: '700' }]}>{o.label}</Text>
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
    alignItems: 'center',
  },
  cardActive: { borderColor: theme.color.brandPrimary, borderWidth: 2, backgroundColor: theme.color.brandTertiary },
  txt: { fontSize: 15, color: theme.color.onSurface, fontWeight: '600' },
});
