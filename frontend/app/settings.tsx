import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';

export default function Settings() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [confirmImport, setConfirmImport] = useState<{ payload: any; mode: 'merge' | 'replace' } | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  const doExport = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const data = await api.exportData();
      const json = JSON.stringify(data, null, 2);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `planeat-backup-${stamp}.json`;
      const path = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(path, json);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(path, {
          mimeType: 'application/json',
          dialogTitle: 'Salva il backup PlanEat',
          UTI: 'public.json',
        });
        setMsg({ kind: 'ok', text: 'Backup esportato con successo.' });
      } else {
        setMsg({ kind: 'ok', text: `Backup salvato in: ${path}` });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || 'Errore esportazione' });
    }
    setBusy(false);
  }, []);

  const pickAndPreview = useCallback(async (mode: 'merge' | 'replace') => {
    setMsg(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const uri = res.assets?.[0]?.uri;
      if (!uri) return;
      const raw = await FileSystem.readAsStringAsync(uri);
      const parsed = JSON.parse(raw);
      if (!parsed || (parsed.app && parsed.app !== 'PlanEat')) {
        setMsg({ kind: 'err', text: 'Il file non sembra un backup PlanEat valido.' });
        return;
      }
      setConfirmImport({ payload: parsed, mode });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || 'Impossibile leggere il file' });
    }
  }, []);

  const doImport = useCallback(async () => {
    if (!confirmImport) return;
    setBusy(true);
    try {
      const p = confirmImport.payload;
      const result = await api.importData({
        dishes: p.dishes || [],
        weekly_plans: p.weekly_plans || [],
        shopping_items: p.shopping_items || [],
        mode: confirmImport.mode,
      });
      const im = result.imported || {};
      setMsg({
        kind: 'ok',
        text: `Ripristino completato: ${im.dishes || 0} piatti, ${im.weekly_plans || 0} settimane, ${im.shopping_items || 0} elementi spesa.`,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setConfirmImport(null);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || 'Errore ripristino' });
    }
    setBusy(false);
  }, [confirmImport]);

  const doLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="settings-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="settings-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.h1}>Impostazioni</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}>
        <View style={styles.section}>
          <Text style={styles.sectionH}>Account</Text>
          <View style={styles.card}>
            <View style={styles.avatar}>
              <Feather name="user" size={20} color={theme.color.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{user?.name}</Text>
              <Text style={styles.emailTxt}>{user?.email}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionH}>Backup dati</Text>
          <Text style={styles.sectionSub}>
            Scarica un file di backup con tutti i tuoi piatti, settimane pianificate e lista spesa. Potrai ripristinarlo in qualsiasi momento su questo o su un altro dispositivo.
          </Text>

          <Pressable onPress={doExport} disabled={busy} style={styles.actionRow} testID="btn-export">
            <View style={[styles.actionIcon, { backgroundColor: theme.color.brandTertiary }]}>
              <Feather name="download" size={18} color={theme.color.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Esporta i miei dati</Text>
              <Text style={styles.actionSub}>Salva un file JSON sul telefono</Text>
            </View>
            {busy ? <ActivityIndicator color={theme.color.brandPrimary} /> : <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />}
          </Pressable>

          <Pressable onPress={() => pickAndPreview('merge')} disabled={busy} style={styles.actionRow} testID="btn-import-merge">
            <View style={[styles.actionIcon, { backgroundColor: '#E5EDDF' }]}>
              <Feather name="upload" size={18} color={theme.color.brandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Ripristina (unisci)</Text>
              <Text style={styles.actionSub}>Aggiungi i dati del backup senza sovrascrivere</Text>
            </View>
            <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
          </Pressable>

          <Pressable onPress={() => pickAndPreview('replace')} disabled={busy} style={styles.actionRow} testID="btn-import-replace">
            <View style={[styles.actionIcon, { backgroundColor: '#F5E0DC' }]}>
              <Feather name="refresh-cw" size={18} color={theme.color.error} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Ripristina (sostituisci)</Text>
              <Text style={styles.actionSub}>Cancella tutto e sostituisci con il backup</Text>
            </View>
            <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
          </Pressable>
        </View>

        {msg ? (
          <View style={[styles.msgBox, msg.kind === 'err' ? styles.msgErr : styles.msgOk]} testID="settings-msg">
            <Feather name={msg.kind === 'err' ? 'alert-circle' : 'check-circle'} size={16} color={msg.kind === 'err' ? theme.color.error : theme.color.success} />
            <Text style={[styles.msgTxt, { color: msg.kind === 'err' ? theme.color.error : theme.color.success }]}>{msg.text}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Pressable onPress={() => setConfirmLogout(true)} style={[styles.actionRow, { borderColor: theme.color.error }]} testID="btn-logout">
            <View style={[styles.actionIcon, { backgroundColor: '#F5E0DC' }]}>
              <Feather name="log-out" size={18} color={theme.color.error} />
            </View>
            <Text style={[styles.actionTitle, { color: theme.color.error }]}>Esci</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Import confirmation */}
      <Modal transparent visible={!!confirmImport} animationType="fade" onRequestClose={() => setConfirmImport(null)}>
        <View style={styles.overlay}>
          <View style={styles.modalCard} testID="confirm-import-modal">
            <View style={styles.modalIcon}>
              <Feather name="upload-cloud" size={24} color={theme.color.brandPrimary} />
            </View>
            <Text style={styles.modalH}>
              Ripristinare i dati {confirmImport?.mode === 'replace' ? '(sostituisci)' : '(unisci)'}?
            </Text>
            <Text style={styles.modalP}>
              {confirmImport?.mode === 'replace'
                ? 'Tutti i tuoi dati attuali verranno cancellati e sostituiti con quelli del backup. Questa operazione non è reversibile.'
                : 'I dati del backup verranno aggiunti ai tuoi. Gli elementi duplicati non verranno sovrascritti.'}
            </Text>
            <Text style={styles.modalStats}>
              {confirmImport?.payload?.dishes?.length || 0} piatti · {confirmImport?.payload?.weekly_plans?.length || 0} settimane · {confirmImport?.payload?.shopping_items?.length || 0} elementi spesa
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
              <Pressable onPress={() => setConfirmImport(null)} style={styles.btnGhost} disabled={busy} testID="import-cancel">
                <Text style={styles.btnGhostTxt}>Annulla</Text>
              </Pressable>
              <Pressable onPress={doImport} style={confirmImport?.mode === 'replace' ? styles.btnDanger : styles.btnPrim} disabled={busy} testID="import-confirm">
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.btnDangerTxt}>{confirmImport?.mode === 'replace' ? 'Sostituisci' : 'Ripristina'}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Logout confirmation */}
      <Modal transparent visible={confirmLogout} animationType="fade" onRequestClose={() => setConfirmLogout(false)}>
        <View style={styles.overlay}>
          <View style={styles.modalCard} testID="confirm-logout-modal">
            <View style={styles.modalIcon}>
              <Feather name="log-out" size={24} color={theme.color.error} />
            </View>
            <Text style={styles.modalH}>Uscire da PlanEat?</Text>
            <Text style={styles.modalP}>
              I tuoi dati restano al sicuro sul cloud. Puoi rientrare in ogni momento con lo stesso account.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
              <Pressable onPress={() => setConfirmLogout(false)} style={styles.btnGhost} testID="logout-cancel">
                <Text style={styles.btnGhostTxt}>Annulla</Text>
              </Pressable>
              <Pressable onPress={doLogout} style={styles.btnDanger} testID="logout-confirm">
                <Text style={styles.btnDangerTxt}>Esci</Text>
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
  section: { marginBottom: theme.spacing.xl },
  sectionH: { fontFamily: theme.font.display, fontSize: 16, color: theme.color.onSurface, marginBottom: theme.spacing.sm },
  sectionSub: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginBottom: theme.spacing.md, lineHeight: 18 },
  card: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.lg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: theme.font.display, fontSize: 16, color: theme.color.onSurface },
  emailTxt: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.md,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surface, marginBottom: theme.spacing.sm,
  },
  actionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { fontSize: 15, color: theme.color.onSurface, fontWeight: '500' },
  actionSub: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  msgBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: theme.spacing.md, borderRadius: theme.radius.md, marginTop: theme.spacing.sm },
  msgOk: { backgroundColor: '#E5EDDF' },
  msgErr: { backgroundColor: '#F5E0DC' },
  msgTxt: { flex: 1, fontSize: 13, lineHeight: 18 },
  overlay: { flex: 1, backgroundColor: 'rgba(44,40,38,0.55)', alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  modalCard: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, padding: theme.spacing.xl, width: '100%', maxWidth: 380, borderWidth: 1, borderColor: theme.color.border },
  modalIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md },
  modalH: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface, marginBottom: 6 },
  modalP: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 19 },
  modalStats: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.sm, fontStyle: 'italic' },
  btnGhost: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  btnGhostTxt: { color: theme.color.onSurface, fontWeight: '500' },
  btnPrim: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  btnDanger: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.error, alignItems: 'center', justifyContent: 'center' },
  btnDangerTxt: { color: '#fff', fontWeight: '600' },
});
