import { ScrollView, View, Text, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';
import { useTranslation } from '@/src/i18n';

export default function PrivacyPolicy() {
  const router = useRouter();
  const { t, lang } = useTranslation();
  const OWNER_NAME = 'Mattia Ruo';
  const OWNER_EMAIL = 'crypto.matth719@gmail.com';
  const APP_NAME = 'Planibble';
  const LAST_UPDATED = '2026-06-11';

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="privacy-policy">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="privacy-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.h1}>{t('privacy.header')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.lastUpdated}>{t('privacy.lastUpdated', { date: LAST_UPDATED })}</Text>

        <Section title={t('privacy.owner.h')}>
          <Text style={styles.p}>{t('privacy.owner.body', { name: OWNER_NAME })}</Text>
          <Pressable onPress={() => Linking.openURL(`mailto:${OWNER_EMAIL}`)}>
            <Text style={styles.link}>{OWNER_EMAIL}</Text>
          </Pressable>
        </Section>

        <Section title={t('privacy.dataCollected.h')}>
          <Text style={styles.p}>{t('privacy.dataCollected.intro', { app: APP_NAME })}</Text>
          <Bullet>{t('privacy.dataCollected.b1')}</Bullet>
          <Bullet>{t('privacy.dataCollected.b2')}</Bullet>
          <Bullet>{t('privacy.dataCollected.b3')}</Bullet>
          <Bullet>{t('privacy.dataCollected.b4')}</Bullet>
          <Text style={styles.p}>{t('privacy.dataCollected.noAds')}</Text>
        </Section>

        <Section title={t('privacy.purpose.h')}>
          <Bullet>{t('privacy.purpose.b1')}</Bullet>
          <Bullet>{t('privacy.purpose.b2')}</Bullet>
          <Bullet>{t('privacy.purpose.b3')}</Bullet>
        </Section>

        <Section title={t('privacy.storage.h')}>
          <Text style={styles.p}>{t('privacy.storage.body')}</Text>
        </Section>

        <Section title={t('privacy.retention.h')}>
          <Text style={styles.p}>{t('privacy.retention.body')}</Text>
        </Section>

        <Section title={t('privacy.rights.h')}>
          <Text style={styles.p}>{t('privacy.rights.intro')}</Text>
          <Bullet>{t('privacy.rights.access')}</Bullet>
          <Bullet>{t('privacy.rights.rect')}</Bullet>
          <Bullet>{t('privacy.rights.delete')}</Bullet>
          <Bullet>{t('privacy.rights.port')}</Bullet>
          <Bullet>{t('privacy.rights.oppose')}</Bullet>
          <Text style={styles.p}>{t('privacy.rights.how')}</Text>
        </Section>

        <Section title={t('privacy.security.h')}>
          <Text style={styles.p}>{t('privacy.security.body')}</Text>
        </Section>

        <Section title={t('privacy.thirdParties.h')}>
          <Text style={styles.p}>{t('privacy.thirdParties.body')}</Text>
        </Section>

        <Section title={t('privacy.minors.h')}>
          <Text style={styles.p}>{t('privacy.minors.body')}</Text>
        </Section>

        <Section title={t('privacy.changes.h')}>
          <Text style={styles.p}>{t('privacy.changes.body')}</Text>
        </Section>

        <Section title={t('privacy.contact.h')}>
          <Text style={styles.p}>{t('privacy.contact.body')}</Text>
          <Pressable onPress={() => Linking.openURL(`mailto:${OWNER_EMAIL}`)}>
            <Text style={styles.link}>{OWNER_EMAIL}</Text>
          </Pressable>
        </Section>

        <Text style={styles.footer}>
          © {new Date().getFullYear()} {OWNER_NAME} · {APP_NAME}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>{title}</Text>
      {children}
    </View>
  );
}
function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4, paddingLeft: 4 }}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={[styles.p, { flex: 1 }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1, borderBottomColor: theme.color.divider,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  h1: { fontFamily: theme.font.display, fontSize: 22, color: theme.color.onSurface },
  body: { padding: theme.spacing.lg, paddingBottom: 40 },
  lastUpdated: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginBottom: theme.spacing.lg, fontStyle: 'italic' },
  section: { marginBottom: theme.spacing.lg },
  h2: { fontFamily: theme.font.display, fontSize: 17, color: theme.color.brandPrimary, marginBottom: 6 },
  p: { fontSize: 14, color: theme.color.onSurface, lineHeight: 20, marginBottom: 6 },
  bulletDot: { fontSize: 14, color: theme.color.brand, lineHeight: 20 },
  link: { color: theme.color.brandPrimary, fontWeight: '600', textDecorationLine: 'underline', fontSize: 14 },
  footer: { fontSize: 11, color: theme.color.onSurfaceTertiary, textAlign: 'center', marginTop: theme.spacing.xl },
});
