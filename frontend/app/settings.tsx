import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Modal, TextInput, Keyboard, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { resetAllTutorial } from '@/src/tutorial';

type Msg = { kind: 'ok' | 'err'; text: string } | null;

export default function Settings() {
  const router = useRouter();
  const { user, logout, updateUsername, updatePassword } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [confirmImport, setConfirmImport] = useState<{ payload: any; mode: 'merge' | 'replace' } | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [editUsernameOpen, setEditUsernameOpen] = useState(false);
  const [editPasswordOpen, setEditPasswordOpen] = useState(false);

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

      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setMsg({ kind: 'ok', text: 'Backup scaricato con successo.' });
      } else {
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
      let raw: string;
      if (Platform.OS === 'web') {
        raw = await new Promise<string>((resolve, reject) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'application/json,.json';
          input.onchange = () => {
            const f = input.files?.[0];
            if (!f) { reject(new Error('Nessun file selezionato')); return; }
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Lettura fallita'));
            reader.readAsText(f);
          };
          input.click();
        });
      } else {
        const res = await DocumentPicker.getDocumentAsync({
          type: 'application/json',
          copyToCacheDirectory: true,
        });
        if (res.canceled) return;
        const uri = res.assets?.[0]?.uri;
        if (!uri) return;
        raw = await FileSystem.readAsStringAsync(uri);
      }
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

      <KeyboardAwareScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}>
        <View style={styles.section}>
          <Text style={styles.sectionH}>Account</Text>
          <View style={styles.card}>
            <View style={styles.avatar}>
              <Feather name="user" size={20} color={theme.color.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{user?.username}</Text>
              <Text style={styles.emailTxt}>Utente PlanEat</Text>
            </View>
          </View>
          <Pressable onPress={() => setEditUsernameOpen(true)} style={styles.actionRow} testID="btn-edit-username">
            <View style={[styles.actionIcon, { backgroundColor: theme.color.brandTertiary }]}>
              <Feather name="edit-3" size={18} color={theme.color.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Modifica username</Text>
              <Text style={styles.actionSub}>Cambia il tuo nome utente</Text>
            </View>
            <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
          </Pressable>
          <Pressable onPress={() => setEditPasswordOpen(true)} style={styles.actionRow} testID="btn-edit-password">
            <View style={[styles.actionIcon, { backgroundColor: theme.color.brandTertiary }]}>
              <Feather name="lock" size={18} color={theme.color.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Cambia password</Text>
              <Text style={styles.actionSub}>Aggiorna la tua password</Text>
            </View>
            <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
          </Pressable>
          <Pressable onPress={() => router.push('/recovery-manage')} style={styles.actionRow} testID="btn-recovery-codes">
            <View style={[styles.actionIcon, { backgroundColor: theme.color.brandTertiary }]}>
              <Feather name="shield" size={18} color={theme.color.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Codici di recupero</Text>
              <Text style={styles.actionSub}>Rigenera nuovi codici (i vecchi non funzioneranno più)</Text>
            </View>
            <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionH}>Guida</Text>
          <Pressable
            onPress={async () => { await resetAllTutorial(); router.push('/tutorial'); }}
            style={styles.actionRow}
            testID="btn-review-tutorial"
          >
            <View style={[styles.actionIcon, { backgroundColor: '#E5EDDF' }]}>
              <Feather name="play-circle" size={18} color={theme.color.brandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Rivedi tutorial</Text>
              <Text style={styles.actionSub}>Ripeti l'introduzione e mostra di nuovo i suggerimenti</Text>
            </View>
            <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionH}>Backup dati</Text>
          <Text style={styles.sectionSub}>
            Scarica un file di backup con tutti i tuoi piatti, settimane pianificate e lista spesa. Potrai ripristinarlo in qualsiasi momento.
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
      </KeyboardAwareScrollView>

      <EditUsernameModal
        open={editUsernameOpen}
        currentUsername={user?.username || ''}
        onClose={() => setEditUsernameOpen(false)}
        onSave={async (u, pw) => {
          await updateUsername(u, pw);
          setEditUsernameOpen(false);
          setMsg({ kind: 'ok', text: 'Username aggiornato.' });
        }}
      />
      <ChangePasswordModal
        open={editPasswordOpen}
        onClose={() => setEditPasswordOpen(false)}
        onSave={async (oldPw, newPw) => {
          await updatePassword(oldPw, newPw);
          setEditPasswordOpen(false);
          setMsg({ kind: 'ok', text: 'Password aggiornata.' });
        }}
      />

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

function EditUsernameModal({ open, currentUsername, onClose, onSave }: {
  open: boolean; currentUsername: string;
  onClose: () => void;
  onSave: (username: string, current_password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (open) { setUsername(currentUsername); setPw(''); setErr(''); } }, [open, currentUsername]);

  const submit = async () => {
    Keyboard.dismiss(); setErr('');
    setBusy(true);
    try { await onSave(username.trim(), pw); } catch (e: any) { setErr(e.message || 'Errore'); }
    setBusy(false);
  };

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalCard} testID="edit-username-modal">
          <Text style={styles.modalH}>Modifica username</Text>
          <Text style={styles.modalP}>Inserisci il nuovo username e conferma con la tua password attuale.</Text>
          <View style={{ height: theme.spacing.md }} />
          <TextInput
            testID="edit-username-input"
            placeholder="Nuovo username"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            value={username} onChangeText={setUsername}
            autoCapitalize="none" autoCorrect={false}
            style={styles.modalInput}
          />
          <TextInput
            testID="edit-username-password"
            placeholder="Password attuale"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            value={pw} onChangeText={setPw}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.modalInput}
          />
          {err ? <Text style={styles.err} testID="edit-username-error">{err}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.sm }}>
            <Pressable onPress={onClose} style={styles.btnGhost} disabled={busy} testID="edit-username-cancel">
              <Text style={styles.btnGhostTxt}>Annulla</Text>
            </Pressable>
            <Pressable onPress={submit} style={styles.btnPrim} disabled={busy} testID="edit-username-save">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnDangerTxt}>Salva</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ChangePasswordModal({ open, onClose, onSave }: {
  open: boolean;
  onClose: () => void;
  onSave: (oldPw: string, newPw: string) => Promise<void>;
}) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (open) { setOldPw(''); setNewPw(''); setNewPw2(''); setErr(''); } }, [open]);

  const submit = async () => {
    Keyboard.dismiss(); setErr('');
    if (newPw.length < 6) { setErr('La nuova password deve avere almeno 6 caratteri'); return; }
    if (newPw !== newPw2) { setErr('Le due password non coincidono'); return; }
    setBusy(true);
    try { await onSave(oldPw, newPw); } catch (e: any) { setErr(e.message || 'Errore'); }
    setBusy(false);
  };

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalCard} testID="edit-password-modal">
          <Text style={styles.modalH}>Cambia password</Text>
          <Text style={styles.modalP}>Serve la password attuale per confermare la modifica.</Text>
          <View style={{ height: theme.spacing.md }} />
          <TextInput
            testID="edit-password-old"
            placeholder="Password attuale"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            value={oldPw} onChangeText={setOldPw}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.modalInput}
          />
          <TextInput
            testID="edit-password-new"
            placeholder="Nuova password (min 6)"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            value={newPw} onChangeText={setNewPw}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.modalInput}
          />
          <TextInput
            testID="edit-password-new2"
            placeholder="Ripeti nuova password"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            value={newPw2} onChangeText={setNewPw2}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.modalInput}
          />
          {err ? <Text style={styles.err} testID="edit-password-error">{err}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.sm }}>
            <Pressable onPress={onClose} style={styles.btnGhost} disabled={busy} testID="edit-password-cancel">
              <Text style={styles.btnGhostTxt}>Annulla</Text>
            </Pressable>
            <Pressable onPress={submit} style={styles.btnPrim} disabled={busy} testID="edit-password-save">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnDangerTxt}>Salva</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
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
  card: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.lg, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface, marginBottom: theme.spacing.sm },
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
  modalInput: {
    height: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    paddingHorizontal: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary,
    color: theme.color.onSurface, fontSize: 15, marginBottom: theme.spacing.sm,
  },
  err: { color: theme.color.error, fontSize: 13, marginTop: 4 },
  btnGhost: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  btnGhostTxt: { color: theme.color.onSurface, fontWeight: '500' },
  btnPrim: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  btnDanger: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.error, alignItems: 'center', justifyContent: 'center' },
  btnDangerTxt: { color: '#fff', fontWeight: '600' },
});
