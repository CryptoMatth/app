import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

export default function RecoveryManage() {
  const router = useRouter();
  const [remaining, setRemaining] = useState<number | null>(null);
  const [total, setTotal] = useState<number>(8);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.recoveryStatus();
      setRemaining(s.remaining);
      setTotal(s.total || 8);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const regenerate = async () => {
    setBusy(true);
    try {
      const res = await api.recoveryRegenerate();
      setNewCodes(res.recovery_codes);
      setConfirmOpen(false);
      await load();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="recovery-manage-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="recovery-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.h1}>Codici di recupero</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
        <View style={styles.card}>
          <View style={styles.iconBig}><Feather name="shield" size={26} color={theme.color.brandPrimary} /></View>
          <Text style={styles.cardH}>{remaining ?? '—'} di {total} codici rimasti</Text>
          <Text style={styles.cardP}>
            I codici di recupero permettono di reimpostare la password se la dimentichi. Ogni codice può essere usato una sola volta.
          </Text>
        </View>

        {newCodes && (
          <View style={styles.newBox}>
            <Text style={styles.newH}>Nuovi codici</Text>
            <Text style={styles.newSub}>Salvali subito — non li rivedrai più.</Text>
            <View style={styles.codes}>
              {newCodes.map((c, i) => (
                <Text key={i} style={styles.code} selectable testID={`new-code-${i}`}>{c}</Text>
              ))}
            </View>
          </View>
        )}

        <Pressable onPress={() => setConfirmOpen(true)} style={styles.dangerBtn} testID="regenerate-btn">
          <Feather name="refresh-cw" size={16} color={theme.color.error} />
          <Text style={styles.dangerTxt}>Rigenera tutti i codici</Text>
        </Pressable>
        <Text style={styles.hint}>Attenzione: i vecchi codici smetteranno di funzionare.</Text>
      </ScrollView>

      <Modal transparent visible={confirmOpen} animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.modal} testID="regenerate-confirm-modal">
            <View style={styles.modalIcon}>
              <Feather name="alert-triangle" size={24} color={theme.color.error} />
            </View>
            <Text style={styles.modalH}>Rigenerare i codici?</Text>
            <Text style={styles.modalP}>
              I tuoi vecchi codici di recupero non funzioneranno più. Assicurati di salvare i nuovi codici in un luogo sicuro.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
              <Pressable onPress={() => setConfirmOpen(false)} style={styles.btnGhost} disabled={busy}>
                <Text style={styles.btnGhostTxt}>Annulla</Text>
              </Pressable>
              <Pressable onPress={regenerate} style={styles.btnDanger} disabled={busy} testID="regenerate-confirm">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnDangerTxt}>Rigenera</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  h1: { flex: 1, textAlign: 'center', fontFamily: theme.font.display, fontSize: 20, color: theme.color.onSurface },
  card: { padding: theme.spacing.lg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface, alignItems: 'center' },
  iconBig: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md },
  cardH: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface, textAlign: 'center' },
  cardP: { fontSize: 13, color: theme.color.onSurfaceSecondary, textAlign: 'center', marginTop: theme.spacing.sm, lineHeight: 18 },
  newBox: { marginTop: theme.spacing.lg, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.brandPrimary, padding: theme.spacing.lg },
  newH: { fontFamily: theme.font.display, fontSize: 16, color: theme.color.brandPrimary },
  newSub: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  codes: { alignItems: 'center', marginTop: theme.spacing.md, gap: 6 },
  code: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.brandPrimary, letterSpacing: 3, fontWeight: '600' },
  dangerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', height: 50, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.error, backgroundColor: theme.color.surface, marginTop: theme.spacing.xl },
  dangerTxt: { color: theme.color.error, fontWeight: '600' },
  hint: { fontSize: 11, color: theme.color.onSurfaceTertiary, textAlign: 'center', marginTop: theme.spacing.sm },
  overlay: { flex: 1, backgroundColor: 'rgba(44,40,38,0.55)', alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  modal: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, padding: theme.spacing.xl, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: theme.color.border },
  modalIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F5E0DC', alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md },
  modalH: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface, marginBottom: 6 },
  modalP: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 19 },
  btnGhost: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  btnGhostTxt: { color: theme.color.onSurface, fontWeight: '500' },
  btnDanger: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.error, alignItems: 'center', justifyContent: 'center' },
  btnDangerTxt: { color: '#fff', fontWeight: '600' },
});
