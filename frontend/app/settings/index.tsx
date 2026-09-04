import { View, Text, Pressable, ScrollView, Modal, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { useTranslation } from '@/src/i18n';
import { useIsPro, ProUpsellModal } from '@/src/ProGate';

type Row = {
  key: string;
  href?: any;
  onPress?: () => void;
  icon: keyof typeof Feather.glyphMap;
  bg?: string;
  color?: string;
  title: string;
  sub: string;
  danger?: boolean;
  testID?: string;
};

export default function SettingsHome() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const isPro = useIsPro();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [upsell, setUpsell] = useState(false);

  const doLogout = async () => {
    setBusy(true);
    try { await logout(); router.replace('/(auth)/login'); } catch {}
    setBusy(false);
  };

  const sections: { title: string; rows: Row[] }[] = [
    {
      title: t('settings.section.account'),
      rows: [
        {
          key: 'account',
          href: '/settings/account',
          icon: 'user',
          bg: theme.color.brandTertiary,
          color: theme.color.brandPrimary,
          title: t('settings.account.title'),
          sub: t('settings.account.sub', { username: user?.username || '—' }),
          testID: 'nav-account',
        },
      ],
    },
    {
      title: t('settings.section.customization'),
      rows: [
        {
          key: 'prefs',
          href: '/settings/preferences',
          icon: 'sliders',
          bg: '#E5EDDF',
          color: theme.color.brandSecondary,
          title: t('settings.prefs.title'),
          sub: t('settings.prefs.sub'),
          testID: 'nav-preferences',
        },
      ],
    },
    {
      title: t('settings.section.plans'),
      rows: [
        {
          key: 'plans',
          href: '/settings/plans',
          icon: 'award',
          bg: '#F5E8D8',
          color: theme.color.brand,
          title: t('settings.plans.title'),
          sub: t('settings.plans.sub'),
          testID: 'nav-plans',
        },
      ],
    },
    {
      title: t('settings.section.guide'),
      rows: [
        {
          key: 'tutorial',
          href: '/settings/tutorial',
          icon: 'play-circle',
          bg: '#E5EDDF',
          color: theme.color.brandSecondary,
          title: t('settings.tutorial.title'),
          sub: t('settings.tutorial.sub'),
          testID: 'nav-tutorial',
        },
        {
          key: 'contact',
          href: '/settings/contact',
          icon: 'mail',
          bg: theme.color.brandTertiary,
          color: theme.color.brandPrimary,
          title: t('settings.contact.title'),
          sub: t('settings.contact.sub'),
          testID: 'nav-contact',
        },
      ],
    },
    {
      title: t('settings.section.data'),
      rows: [
        {
          key: 'backup',
          href: '/settings/backup',
          icon: 'archive',
          bg: theme.color.brandTertiary,
          color: theme.color.brandPrimary,
          title: t('settings.backup.title'),
          sub: t('settings.backup.sub'),
          testID: 'nav-backup',
        },
      ],
    },
    {
      title: t('settings.section.danger'),
      rows: [
        {
          key: 'logout',
          onPress: () => setConfirmLogout(true),
          icon: 'log-out',
          bg: '#F5E0DC',
          color: theme.color.error,
          title: t('settings.logout.title'),
          sub: t('settings.logout.sub'),
          danger: true,
          testID: 'btn-logout',
        },
      ],
    },
  ];

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="settings-hub">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back} testID="settings-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={s.h1}>{t('settings.header')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}>
        {/* Pro status card */}
        <Pressable
          onPress={() => !isPro && setUpsell(true)}
          disabled={isPro}
          style={[proCardStyles.card, isPro ? proCardStyles.cardPro : proCardStyles.cardFree]}
          testID="pro-status-card"
        >
          <View style={[proCardStyles.iconWrap, { backgroundColor: isPro ? 'rgba(255,255,255,0.22)' : '#F5E8D8' }]}>
            <Feather name={isPro ? 'star' : 'lock'} size={20} color={isPro ? '#fff' : theme.color.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[proCardStyles.title, { color: isPro ? '#fff' : theme.color.onSurface }]}>
              {isPro ? t('settings.pro.activeTitle') : t('settings.pro.freeTitle')}
            </Text>
            <Text style={[proCardStyles.sub, { color: isPro ? 'rgba(255,255,255,0.85)' : theme.color.onSurfaceSecondary }]}>
              {isPro ? t('settings.pro.activeSub') : t('settings.pro.freeSub')}
            </Text>
          </View>
          {!isPro && <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />}
        </Pressable>

        {sections.map(sec => (
          <View key={sec.title} style={s.section}>
            <Text style={s.sectionH}>{sec.title}</Text>
            {sec.rows.map(r => (
              <Pressable
                key={r.key}
                onPress={() => (r.href ? router.push(r.href) : r.onPress?.())}
                style={[s.actionRow, r.danger && { borderColor: theme.color.error }]}
                testID={r.testID}
              >
                <View style={[s.actionIcon, { backgroundColor: r.bg || theme.color.brandTertiary }]}>
                  <Feather name={r.icon} size={18} color={r.color || theme.color.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.actionTitle, r.danger && { color: theme.color.error }]}>{r.title}</Text>
                  <Text style={s.actionSub}>{r.sub}</Text>
                </View>
                {r.href ? (
                  <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
                ) : null}
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>

      <Modal transparent visible={confirmLogout} animationType="fade" onRequestClose={() => setConfirmLogout(false)}>
        <View style={s.overlay}>
          <View style={s.modalCard} testID="confirm-logout-modal">
            <View style={s.modalIcon}>
              <Feather name="log-out" size={24} color={theme.color.error} />
            </View>
            <Text style={s.modalH}>{t('settings.logout.confirmTitle')}</Text>
            <Text style={s.modalP}>
              {t('settings.logout.confirmBody')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
              <Pressable onPress={() => setConfirmLogout(false)} style={s.btnGhost} disabled={busy} testID="logout-cancel">
                <Text style={s.btnGhostTxt}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable onPress={doLogout} style={s.btnDanger} disabled={busy} testID="logout-confirm">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnDangerTxt}>{t('settings.logout.title')}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ProUpsellModal open={upsell} onClose={() => setUpsell(false)} feature="settings" />
    </SafeAreaView>
  );
}

const proCardStyles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    marginBottom: theme.spacing.lg,
  },
  cardPro: {
    backgroundColor: theme.color.brand,
    borderColor: theme.color.brand,
  },
  cardFree: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 2, lineHeight: 16 },
});
