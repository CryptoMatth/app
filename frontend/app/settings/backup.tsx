import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, Modal, Platform, ScrollView, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { useTranslation, localeOf } from '@/src/i18n';
import { useAuth, BackupFrequency } from '@/src/auth';
import { useHasTier, ProUpsellModal } from '@/src/ProGate';

type Msg = { kind: 'ok' | 'err'; text: string } | null;

type BackupItem = {
  id: string;
  kind: 'auto' | 'manual';
  created_at: string;
  size_bytes: number;
  counts: { dishes: number; weekly_plans: number; shopping_items: number; fridge_items: number };
};

type ListResponse = {
  backups: BackupItem[];
  frequency: BackupFrequency;
  last_auto_at: string | null;
  next_due_at: string | null;
  count: number;
  retention: { auto: number; manual: number };
};

const FREQUENCIES: BackupFrequency[] = ['off', 'daily', 'weekly', 'monthly'];

export default function BackupSettings() {
  const router = useRouter();
  const { t, lang } = useTranslation();
  const { prefs, updatePreferences } = useAuth();
  const isUltra = useHasTier('ultra');

  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [freqBusy, setFreqBusy] = useState<BackupFrequency | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [confirmImport, setConfirmImport] = useState<{ payload: any; mode: 'merge' | 'replace' } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<{ b: BackupItem; mode: 'merge' | 'replace' } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BackupItem | null>(null);
  const [selected, setSelected] = useState<BackupItem | null>(null);
  const [cloudList, setCloudList] = useState<ListResponse | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [upsell, setUpsell] = useState(false);

  useEffect(() => {
    if (!msg) return;
    const to = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(to);
  }, [msg]);

  const loadBackups = useCallback(async () => {
    if (!isUltra) return;
    setLoadingList(true);
    try {
      const data: ListResponse = await api.listBackups();
      setCloudList(data);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || t('backup.cloud.errLoad') });
    } finally {
      setLoadingList(false);
    }
  }, [isUltra, t]);

  useEffect(() => { loadBackups(); }, [loadBackups]);

  const formatWhen = useCallback((iso: string | null) => {
    if (!iso) return t('backup.cloud.never');
    try {
      const d = new Date(iso);
      return d.toLocaleString(localeOf(lang), {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }, [lang, t]);

  const formatSize = useCallback((bytes: number) => {
    if (!bytes) return t('size.b', { n: 0 });
    if (bytes < 1024) return t('size.b', { n: bytes });
    if (bytes < 1024 * 1024) return t('size.kb', { n: (bytes / 1024).toFixed(1) });
    return t('size.mb', { n: (bytes / (1024 * 1024)).toFixed(2) });
  }, [t]);

  const setFrequency = useCallback(async (freq: BackupFrequency) => {
    setFreqBusy(freq);
    setMsg(null);
    try {
      await updatePreferences({ backups: { frequency: freq } });
      await loadBackups();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || t('backup.cloud.errFreq') });
    } finally {
      setFreqBusy(null);
    }
  }, [updatePreferences, loadBackups, t]);

  const doBackupNow = useCallback(async () => {
    setCreating(true);
    setMsg(null);
    try {
      await api.createBackup('manual');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMsg({ kind: 'ok', text: t('backup.cloud.created') });
      await loadBackups();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || t('backup.cloud.errCreate') });
    } finally {
      setCreating(false);
    }
  }, [loadBackups, t]);

  const doRestore = useCallback(async () => {
    if (!confirmRestore) return;
    setBusy(true);
    try {
      const r = await api.restoreBackup(confirmRestore.b.id, confirmRestore.mode);
      const im = r.imported || {};
      setMsg({
        kind: 'ok',
        text: t('backup.cloud.restored', {
          d: im.dishes || 0, w: im.weekly_plans || 0,
          s: im.shopping_items || 0, f: im.fridge_items || 0,
        }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setConfirmRestore(null);
      setSelected(null);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || t('backup.cloud.errRestore') });
    } finally {
      setBusy(false);
    }
  }, [confirmRestore, t]);

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api.deleteBackup(confirmDelete.id);
      setConfirmDelete(null);
      setSelected(null);
      await loadBackups();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || t('backup.cloud.errDelete') });
    } finally {
      setBusy(false);
    }
  }, [confirmDelete, loadBackups, t]);

  // ----- Manual export/import (unchanged, kept accessible for every tier) -----
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
        setMsg({ kind: 'ok', text: t('backup.downloaded') });
      } else {
        const path = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(path, json);
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(path, {
            mimeType: 'application/json',
            dialogTitle: t('backup.dialog'),
            UTI: 'public.json',
          });
          setMsg({ kind: 'ok', text: t('backup.exported') });
        } else {
          setMsg({ kind: 'ok', text: t('backup.savedTo', { path }) });
        }
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || t('backup.errExport') });
    }
    setBusy(false);
  }, [t]);

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
            if (!f) { reject(new Error(t('backup.errNoFile'))); return; }
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error(t('backup.errReadFail')));
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
        setMsg({ kind: 'err', text: t('backup.errInvalid') });
        return;
      }
      setConfirmImport({ payload: parsed, mode });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || t('backup.errRead') });
    }
  }, [t]);

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
        text: t('backup.doneMsg', { d: im.dishes || 0, w: im.weekly_plans || 0, s: im.shopping_items || 0 }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setConfirmImport(null);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || t('backup.errRestore') });
    }
    setBusy(false);
  }, [confirmImport, t]);

  const currentFreq: BackupFrequency = (prefs?.backups?.frequency as BackupFrequency) || 'off';

  const freqLabel = (f: BackupFrequency) =>
    ({ off: t('backup.cloud.freq.off'),
       daily: t('backup.cloud.freq.daily'),
       weekly: t('backup.cloud.freq.weekly'),
       monthly: t('backup.cloud.freq.monthly') })[f];

  const renderCloudSection = () => {
    if (!isUltra) {
      return (
        <View style={styles.lockedCard}>
          <View style={styles.lockIconWrap}>
            <Feather name="cloud" size={20} color={theme.color.brand} />
          </View>
          <Text style={styles.lockedH}>{t('backup.cloud.lockedTitle')}</Text>
          <Text style={styles.lockedBody}>{t('backup.cloud.lockedBody')}</Text>
          <Pressable
            onPress={() => setUpsell(true)}
            style={styles.lockedCta}
            testID="btn-cloud-unlock"
          >
            <Feather name="award" size={14} color="#fff" />
            <Text style={styles.lockedCtaTxt}>{t('backup.cloud.unlock')}</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={{ marginBottom: theme.spacing.lg }}>
        <View style={styles.cloudHead}>
          <View style={[s.actionIcon, { backgroundColor: '#F5E8D8' }]}>
            <Feather name="cloud" size={18} color={theme.color.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('backup.cloud.h')}</Text>
            <Text style={s.actionSub}>{t('backup.cloud.sub')}</Text>
          </View>
        </View>

        {/* Frequency chips */}
        <Text style={styles.miniH}>{t('backup.cloud.freq')}</Text>
        <View style={styles.chipRow}>
          {FREQUENCIES.map(f => {
            const active = currentFreq === f;
            const isBusy = freqBusy === f;
            return (
              <Pressable
                key={f}
                onPress={() => !isBusy && setFrequency(f)}
                style={[styles.chip, active && styles.chipActive]}
                testID={`freq-${f}`}
              >
                {isBusy ? (
                  <ActivityIndicator size="small" color={active ? '#fff' : theme.color.brand} />
                ) : (
                  <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{freqLabel(f)}</Text>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Status */}
        {cloudList ? (
          <View style={styles.statusBox}>
            {currentFreq !== 'off' && cloudList.next_due_at ? (
              <Text style={styles.statusTxt}>
                <Feather name="clock" size={11} color={theme.color.onSurfaceSecondary} />
                {' '}{t('backup.cloud.nextDue', { when: formatWhen(cloudList.next_due_at) })}
              </Text>
            ) : null}
            <Text style={styles.statusTxt}>
              <Feather name="refresh-cw" size={11} color={theme.color.onSurfaceSecondary} />
              {' '}{t('backup.cloud.lastAuto', { when: formatWhen(cloudList.last_auto_at) })}
            </Text>
            <Text style={[styles.statusTxt, { color: theme.color.onSurfaceTertiary, fontStyle: 'italic' }]}>
              {t('backup.cloud.retention', {
                auto: cloudList.retention.auto,
                manual: cloudList.retention.manual,
              })}
            </Text>
          </View>
        ) : null}

        {/* Backup now */}
        <Pressable
          onPress={doBackupNow}
          disabled={creating}
          style={[s.actionRow, { marginTop: theme.spacing.sm }]}
          testID="btn-backup-now"
        >
          <View style={[s.actionIcon, { backgroundColor: theme.color.brandTertiary }]}>
            <Feather name="upload-cloud" size={18} color={theme.color.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>
              {creating ? t('backup.cloud.creating') : t('backup.cloud.now')}
            </Text>
            <Text style={s.actionSub}>{t('backup.cloud.nowSub')}</Text>
          </View>
          {creating
            ? <ActivityIndicator color={theme.color.brandPrimary} />
            : <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />}
        </Pressable>

        {/* Backup list */}
        <Text style={[styles.miniH, { marginTop: theme.spacing.md }]}>
          {t('backup.cloud.list')}
        </Text>
        {loadingList && !cloudList ? (
          <View style={{ paddingVertical: 20, alignItems: 'center' }}>
            <ActivityIndicator color={theme.color.brandPrimary} />
          </View>
        ) : (cloudList?.backups?.length || 0) === 0 ? (
          <View style={styles.emptyBox}>
            <Feather name="inbox" size={22} color={theme.color.onSurfaceTertiary} />
            <Text style={styles.emptyTxt}>{t('backup.cloud.empty')}</Text>
          </View>
        ) : (
          cloudList!.backups.map(b => (
            <Pressable
              key={b.id}
              onPress={() => setSelected(b)}
              style={styles.backupRow}
              testID={`backup-row-${b.id}`}
            >
              <View style={[
                styles.kindBadge,
                b.kind === 'auto' ? styles.kindAuto : styles.kindManual,
              ]}>
                <Feather
                  name={b.kind === 'auto' ? 'refresh-cw' : 'user'}
                  size={11}
                  color={b.kind === 'auto' ? theme.color.brand : theme.color.brandPrimary}
                />
                <Text style={[
                  styles.kindTxt,
                  b.kind === 'auto' ? { color: theme.color.brand } : { color: theme.color.brandPrimary },
                ]}>
                  {b.kind === 'auto' ? t('backup.cloud.kind.auto') : t('backup.cloud.kind.manual')}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.backupWhen}>{formatWhen(b.created_at)}</Text>
                <Text style={styles.backupMeta} numberOfLines={1}>
                  {t('backup.cloud.size', {
                    d: b.counts.dishes,
                    w: b.counts.weekly_plans,
                    s: b.counts.shopping_items,
                    f: b.counts.fridge_items,
                    kb: formatSize(b.size_bytes),
                  })}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.color.onSurfaceTertiary} />
            </Pressable>
          ))
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="settings-backup">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back} testID="backup-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={s.h1}>{t('backup.header')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}>
        {renderCloudSection()}

        {/* Manual export/import section */}
        <View style={styles.divider} />
        <Text style={styles.miniH}>{t('backup.cloud.section.manual')}</Text>
        <Text style={[s.sectionSub, { marginBottom: theme.spacing.sm }]}>
          {t('backup.cloud.section.manualSub')}
        </Text>

        <Pressable onPress={doExport} disabled={busy} style={s.actionRow} testID="btn-export">
          <View style={[s.actionIcon, { backgroundColor: theme.color.brandTertiary }]}>
            <Feather name="download" size={18} color={theme.color.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('backup.export')}</Text>
            <Text style={s.actionSub}>{t('backup.exportSub')}</Text>
          </View>
          {busy ? <ActivityIndicator color={theme.color.brandPrimary} /> :
            <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />}
        </Pressable>

        <Pressable onPress={() => pickAndPreview('merge')} disabled={busy} style={s.actionRow} testID="btn-import-merge">
          <View style={[s.actionIcon, { backgroundColor: '#E5EDDF' }]}>
            <Feather name="upload" size={18} color={theme.color.brandSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('backup.merge')}</Text>
            <Text style={s.actionSub}>{t('backup.mergeSub')}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>

        <Pressable onPress={() => pickAndPreview('replace')} disabled={busy} style={s.actionRow} testID="btn-import-replace">
          <View style={[s.actionIcon, { backgroundColor: '#F5E0DC' }]}>
            <Feather name="refresh-cw" size={18} color={theme.color.error} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('backup.replace')}</Text>
            <Text style={s.actionSub}>{t('backup.replaceSub')}</Text>
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
      </ScrollView>

      {/* Cloud backup — actions modal */}
      <Modal transparent visible={!!selected} animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={s.overlay} onPress={() => setSelected(null)}>
          <Pressable style={s.modalCard} onPress={e => e.stopPropagation?.()} testID="cloud-actions-modal">
            <View style={s.modalIcon}>
              <Feather name="database" size={22} color={theme.color.brandPrimary} />
            </View>
            <Text style={s.modalH}>
              {selected ? t('backup.cloud.actions.title', { when: formatWhen(selected.created_at) }) : ''}
            </Text>
            <Text style={s.modalP}>{t('backup.cloud.actions.body')}</Text>
            {selected ? (
              <Text style={styles.modalMeta}>
                {t('backup.cloud.size', {
                  d: selected.counts.dishes,
                  w: selected.counts.weekly_plans,
                  s: selected.counts.shopping_items,
                  f: selected.counts.fridge_items,
                  kb: formatSize(selected.size_bytes),
                })}
              </Text>
            ) : null}
            <View style={{ gap: 8, marginTop: theme.spacing.md }}>
              <Pressable
                onPress={() => selected && setConfirmRestore({ b: selected, mode: 'merge' })}
                style={[s.btnPrim, styles.modalBtn]}
                testID="restore-merge"
              >
                <Feather name="upload" size={14} color="#fff" />
                <Text style={s.btnDangerTxt}>{t('backup.cloud.restore.merge')}</Text>
              </Pressable>
              <Pressable
                onPress={() => selected && setConfirmRestore({ b: selected, mode: 'replace' })}
                style={[s.btnDanger, styles.modalBtn]}
                testID="restore-replace"
              >
                <Feather name="refresh-cw" size={14} color="#fff" />
                <Text style={s.btnDangerTxt}>{t('backup.cloud.restore.replace')}</Text>
              </Pressable>
              <Pressable
                onPress={() => selected && setConfirmDelete(selected)}
                style={[s.btnGhost, styles.modalBtn]}
                testID="delete-backup"
              >
                <Feather name="trash-2" size={14} color={theme.color.error} />
                <Text style={[s.btnGhostTxt, { color: theme.color.error }]}>{t('backup.cloud.deleteBtn')}</Text>
              </Pressable>
              <Pressable
                onPress={() => setSelected(null)}
                style={[s.btnGhost, styles.modalBtn]}
              >
                <Text style={s.btnGhostTxt}>{t('common.close')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Cloud restore confirm */}
      <Modal transparent visible={!!confirmRestore} animationType="fade" onRequestClose={() => setConfirmRestore(null)}>
        <View style={s.overlay}>
          <View style={s.modalCard} testID="confirm-cloud-restore">
            <View style={s.modalIcon}>
              <Feather
                name={confirmRestore?.mode === 'replace' ? 'refresh-cw' : 'upload'}
                size={22}
                color={confirmRestore?.mode === 'replace' ? theme.color.error : theme.color.brandPrimary}
              />
            </View>
            <Text style={s.modalH}>
              {confirmRestore?.mode === 'replace'
                ? t('backup.cloud.restoreConfirmReplace.title')
                : t('backup.cloud.restoreConfirmMerge.title')}
            </Text>
            <Text style={s.modalP}>
              {confirmRestore?.mode === 'replace'
                ? t('backup.cloud.restoreConfirmReplace.body')
                : t('backup.cloud.restoreConfirmMerge.body')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
              <Pressable onPress={() => setConfirmRestore(null)} style={s.btnGhost} disabled={busy} testID="cloud-restore-cancel">
                <Text style={s.btnGhostTxt}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={doRestore}
                style={confirmRestore?.mode === 'replace' ? s.btnDanger : s.btnPrim}
                disabled={busy}
                testID="cloud-restore-confirm"
              >
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <Text style={s.btnDangerTxt}>
                    {confirmRestore?.mode === 'replace' ? t('common.replace') : t('common.restore')}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Cloud delete confirm */}
      <Modal transparent visible={!!confirmDelete} animationType="fade" onRequestClose={() => setConfirmDelete(null)}>
        <View style={s.overlay}>
          <View style={s.modalCard} testID="confirm-cloud-delete">
            <View style={s.modalIcon}>
              <Feather name="trash-2" size={22} color={theme.color.error} />
            </View>
            <Text style={s.modalH}>{t('backup.cloud.deleteConfirm.title')}</Text>
            <Text style={s.modalP}>{t('backup.cloud.deleteConfirm.body')}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
              <Pressable onPress={() => setConfirmDelete(null)} style={s.btnGhost} disabled={busy} testID="cloud-delete-cancel">
                <Text style={s.btnGhostTxt}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable onPress={doDelete} style={s.btnDanger} disabled={busy} testID="cloud-delete-confirm">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnDangerTxt}>{t('common.delete')}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Manual import confirm (existing) */}
      <Modal transparent visible={!!confirmImport} animationType="fade" onRequestClose={() => setConfirmImport(null)}>
        <View style={s.overlay}>
          <View style={s.modalCard} testID="confirm-import-modal">
            <View style={s.modalIcon}>
              <Feather name="upload-cloud" size={24} color={theme.color.brandPrimary} />
            </View>
            <Text style={s.modalH}>
              {confirmImport?.mode === 'replace' ? t('backup.confirmTitleReplace') : t('backup.confirmTitleMerge')}
            </Text>
            <Text style={s.modalP}>
              {confirmImport?.mode === 'replace' ? t('backup.confirmReplace') : t('backup.confirmMerge')}
            </Text>
            <Text style={{ fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.sm, fontStyle: 'italic' }}>
              {t('backup.summary', {
                d: confirmImport?.payload?.dishes?.length || 0,
                w: confirmImport?.payload?.weekly_plans?.length || 0,
                s: confirmImport?.payload?.shopping_items?.length || 0,
              })}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
              <Pressable onPress={() => setConfirmImport(null)} style={s.btnGhost} disabled={busy} testID="import-cancel">
                <Text style={s.btnGhostTxt}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable onPress={doImport}
                style={confirmImport?.mode === 'replace' ? s.btnDanger : s.btnPrim}
                disabled={busy} testID="import-confirm">
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <Text style={s.btnDangerTxt}>{confirmImport?.mode === 'replace' ? t('common.replace') : t('common.restore')}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ProUpsellModal open={upsell} onClose={() => setUpsell(false)} feature="backup_cloud" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cloudHead: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
    marginBottom: theme.spacing.md,
  },
  miniH: {
    fontSize: 13, fontWeight: '600', color: theme.color.onSurfaceSecondary,
    marginBottom: 6,
  },
  chipRow: {
    flexDirection: 'row', gap: 6, marginBottom: theme.spacing.sm, flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surface, minHeight: 34, alignItems: 'center', justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: theme.color.brand,
    borderColor: theme.color.brand,
  },
  chipTxt: { fontSize: 12, color: theme.color.onSurface, fontWeight: '500' },
  chipTxtActive: { color: '#fff', fontWeight: '600' },
  statusBox: {
    padding: theme.spacing.sm, gap: 4,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
    marginBottom: theme.spacing.sm,
  },
  statusTxt: { fontSize: 11, color: theme.color.onSurfaceSecondary, lineHeight: 15 },
  emptyBox: {
    paddingVertical: 20, alignItems: 'center', gap: 8,
    borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border,
    borderStyle: 'dashed',
  },
  emptyTxt: { fontSize: 12, color: theme.color.onSurfaceTertiary, textAlign: 'center', paddingHorizontal: 20 },
  backupRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border,
    marginBottom: 6,
    backgroundColor: theme.color.surface,
  },
  kindBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8,
  },
  kindAuto: { backgroundColor: '#F5E8D8' },
  kindManual: { backgroundColor: theme.color.brandTertiary },
  kindTxt: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  backupWhen: { fontSize: 13, fontWeight: '600', color: theme.color.onSurface },
  backupMeta: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  divider: {
    height: 1, backgroundColor: theme.color.divider, marginVertical: theme.spacing.md,
  },
  modalMeta: {
    fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.sm,
    fontStyle: 'italic',
  },
  modalBtn: {
    flexDirection: 'row', gap: 8,
  },
  // Locked (non-Ultra) card
  lockedCard: {
    padding: theme.spacing.lg, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceSecondary,
    marginBottom: theme.spacing.lg,
    alignItems: 'flex-start', gap: 8,
  },
  lockIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#F5E8D8',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  lockedH: {
    fontFamily: theme.font.display, fontSize: 16, color: theme.color.onSurface,
  },
  lockedBody: {
    fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 18,
    marginBottom: theme.spacing.sm,
  },
  lockedCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: theme.color.brand,
    borderRadius: theme.radius.pill,
  },
  lockedCtaTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
