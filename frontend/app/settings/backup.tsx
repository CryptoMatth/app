import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Modal, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';

type Msg = { kind: 'ok' | 'err'; text: string } | null;

export default function BackupSettings() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [confirmImport, setConfirmImport] = useState<{ payload: any; mode: 'merge' | 'replace' } | null>(null);

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
        const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
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

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="settings-backup">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back} testID="backup-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={s.h1}>Backup dati</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={{ padding: theme.spacing.lg }}>
        <Text style={s.sectionSub}>
          Scarica un file di backup con tutti i tuoi piatti, settimane pianificate e lista spesa. Potrai ripristinarlo in qualsiasi momento.
        </Text>

        <Pressable onPress={doExport} disabled={busy} style={s.actionRow} testID="btn-export">
          <View style={[s.actionIcon, { backgroundColor: theme.color.brandTertiary }]}>
            <Feather name="download" size={18} color={theme.color.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>Esporta i miei dati</Text>
            <Text style={s.actionSub}>Salva un file JSON sul telefono</Text>
          </View>
          {busy ? <ActivityIndicator color={theme.color.brandPrimary} /> :
            <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />}
        </Pressable>

        <Pressable onPress={() => pickAndPreview('merge')} disabled={busy} style={s.actionRow} testID="btn-import-merge">
          <View style={[s.actionIcon, { backgroundColor: '#E5EDDF' }]}>
            <Feather name="upload" size={18} color={theme.color.brandSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>Ripristina (unisci)</Text>
            <Text style={s.actionSub}>Aggiungi i dati del backup senza sovrascrivere</Text>
          </View>
          <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>

        <Pressable onPress={() => pickAndPreview('replace')} disabled={busy} style={s.actionRow} testID="btn-import-replace">
          <View style={[s.actionIcon, { backgroundColor: '#F5E0DC' }]}>
            <Feather name="refresh-cw" size={18} color={theme.color.error} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>Ripristina (sostituisci)</Text>
            <Text style={s.actionSub}>Cancella tutto e sostituisci con il backup</Text>
          </View>
          <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>

        {msg ? (
          <View style={[s.msgBox, msg.kind === 'err' ? s.msgErr : s.msgOk]} testID="backup-msg">
            <Feather name={msg.kind === 'err' ? 'alert-circle' : 'check-circle'} size={16}
              color={msg.kind === 'err' ? theme.color.error : theme.color.success} />
            <Text style={[s.msgTxt, { color: msg.kind === 'err' ? theme.color.error : theme.color.success }]}>{msg.text}</Text>
          </View>
        ) : null}
      </View>

      <Modal transparent visible={!!confirmImport} animationType="fade" onRequestClose={() => setConfirmImport(null)}>
        <View style={s.overlay}>
          <View style={s.modalCard} testID="confirm-import-modal">
            <View style={s.modalIcon}>
              <Feather name="upload-cloud" size={24} color={theme.color.brandPrimary} />
            </View>
            <Text style={s.modalH}>
              Ripristinare i dati {confirmImport?.mode === 'replace' ? '(sostituisci)' : '(unisci)'}?
            </Text>
            <Text style={s.modalP}>
              {confirmImport?.mode === 'replace'
                ? 'Tutti i tuoi dati attuali verranno cancellati e sostituiti con quelli del backup. Questa operazione non è reversibile.'
                : 'I dati del backup verranno aggiunti ai tuoi. Gli elementi duplicati non verranno sovrascritti.'}
            </Text>
            <Text style={{ fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.sm, fontStyle: 'italic' }}>
              {confirmImport?.payload?.dishes?.length || 0} piatti · {confirmImport?.payload?.weekly_plans?.length || 0} settimane · {confirmImport?.payload?.shopping_items?.length || 0} elementi spesa
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
              <Pressable onPress={() => setConfirmImport(null)} style={s.btnGhost} disabled={busy} testID="import-cancel">
                <Text style={s.btnGhostTxt}>Annulla</Text>
              </Pressable>
              <Pressable onPress={doImport}
                style={confirmImport?.mode === 'replace' ? s.btnDanger : s.btnPrim}
                disabled={busy} testID="import-confirm">
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <Text style={s.btnDangerTxt}>{confirmImport?.mode === 'replace' ? 'Sostituisci' : 'Ripristina'}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
