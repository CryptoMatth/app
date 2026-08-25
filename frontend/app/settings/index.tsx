import { View, Text, Pressable, ScrollView, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';

type Row = {
  key: string;
  href?: any;
  onPress?: () => void;
  icon: keyof typeof import('@expo/vector-icons').Feather.glyphMap;
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
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [busy, setBusy] = useState(false);

  const doLogout = async () => {
    setBusy(true);
    try { await logout(); router.replace('/(auth)/login'); } catch {}
    setBusy(false);
  };

  const sections: { title: string; rows: Row[] }[] = [
    {
      title: 'Account',
      rows: [
        {
          key: 'account',
          href: '/settings/account',
          icon: 'user',
          bg: theme.color.brandTertiary,
          color: theme.color.brandPrimary,
          title: 'Il tuo account',
          sub: `${user?.username || '—'} · username, password, sicurezza`,
          testID: 'nav-account',
        },
      ],
    },
    {
      title: 'Personalizzazione',
      rows: [
        {
          key: 'prefs',
          href: '/settings/preferences',
          icon: 'sliders',
          bg: '#E5EDDF',
          color: theme.color.brandSecondary,
          title: 'Preferenze',
          sub: 'Inizio settimana e categorie dei piatti',
          testID: 'nav-preferences',
        },
      ],
    },
    {
      title: 'Guida',
      rows: [
        {
          key: 'tutorial',
          href: '/settings/tutorial',
          icon: 'play-circle',
          bg: '#E5EDDF',
          color: theme.color.brandSecondary,
          title: 'Guida & Tutorial',
          sub: 'Rivedi l\'introduzione e mostra di nuovo i suggerimenti',
          testID: 'nav-tutorial',
        },
      ],
    },
    {
      title: 'Dati',
      rows: [
        {
          key: 'backup',
          href: '/settings/backup',
          icon: 'archive',
          bg: theme.color.brandTertiary,
          color: theme.color.brandPrimary,
          title: 'Backup & Ripristino',
          sub: 'Esporta o importa un file JSON con tutti i tuoi dati',
          testID: 'nav-backup',
        },
      ],
    },
    {
      title: 'Zona pericolo',
      rows: [
        {
          key: 'logout',
          onPress: () => setConfirmLogout(true),
          icon: 'log-out',
          bg: '#F5E0DC',
          color: theme.color.error,
          title: 'Esci',
          sub: 'Termina la sessione su questo dispositivo',
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
        <Text style={s.h1}>Impostazioni</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}>
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
            <Text style={s.modalH}>Uscire da PlanEat?</Text>
            <Text style={s.modalP}>
              I tuoi dati restano al sicuro sul cloud. Puoi rientrare in ogni momento con lo stesso account.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
              <Pressable onPress={() => setConfirmLogout(false)} style={s.btnGhost} disabled={busy} testID="logout-cancel">
                <Text style={s.btnGhostTxt}>Annulla</Text>
              </Pressable>
              <Pressable onPress={doLogout} style={s.btnDanger} disabled={busy} testID="logout-confirm">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnDangerTxt}>Esci</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
