import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Modal, Keyboard, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { useTranslation } from '@/src/i18n';
import { IngredientEditorForm, type IngredientDraft } from '@/src/IngredientEditorForm';

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseIso(s?: string | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function daysUntil(iso: string): number {
  const d = parseIso(iso); if (!d) return Number.NaN;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
}

export default function FridgeEditor() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id as string;
  const { t, locale } = useTranslation();

  const [draft, setDraft] = useState<IngredientDraft>({ name: '', quantity: '', unit: 'g', category_id: 'altro', notes: '', photo_path: null });
  const [expiries, setExpiries] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [datePicking, setDatePicking] = useState<{ index: number | null; value: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listFridge();
        const it = list.find((x: any) => x.id === id);
        if (it) {
          setDraft({
            name: it.name || '',
            quantity: String(it.quantity || 0),
            unit: it.unit || 'g',
            notes: it.notes || '',
            category_id: it.category_id || 'altro',
            photo_path: it.photo_path || null,
          });
          setExpiries([...(it.expiries || [])].sort());
        }
      } catch {}
      setLoading(false);
    })();
  }, [id]);

  const save = async () => {
    Keyboard.dismiss();
    setErr('');
    if (!draft.name.trim()) { setErr(t('spesa.errors.name')); return; }
    const q = parseFloat((draft.quantity || '0').replace(',', '.'));
    if (isNaN(q) || q < 0) { setErr(t('spesa.errors.qty')); return; }
    setBusy(true);
    try {
      await api.editFridge(id, {
        name: draft.name.trim(),
        quantity: q,
        unit: draft.unit,
        notes: draft.notes || '',
        category_id: draft.category_id,
        photo_path: draft.photo_path || null,
        expiries: [...expiries].sort(),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.back();
    } catch (e: any) {
      setErr(e.message || t('spesa.errors.save'));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    try {
      await api.deleteFridge(id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      router.back();
    } catch {}
  };

  const addExpiry = () => {
    const def = todayIso();
    setDatePicking({ index: null, value: def });
  };
  const editExpiry = (i: number) => {
    setDatePicking({ index: i, value: expiries[i] });
  };
  const removeExpiry = (i: number) => {
    setExpiries(prev => prev.filter((_, idx) => idx !== i));
    Haptics.selectionAsync();
  };
  const commitDate = (iso: string) => {
    if (!datePicking) return;
    if (datePicking.index === null) {
      if (!expiries.includes(iso)) setExpiries(prev => [...prev, iso].sort());
    } else {
      const arr = [...expiries]; arr[datePicking.index] = iso;
      setExpiries(arr.sort());
    }
    setDatePicking(null);
    Haptics.selectionAsync();
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={theme.color.brandPrimary} /></View>;
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="fridge-editor">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.hBtn} testID="fridge-back">
          <Feather name="x" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.hTitle}>{t('fridge.editor.title')}</Text>
        <Pressable onPress={() => setShowDelete(true)} style={styles.hBtn} testID="fridge-delete-btn">
          <Feather name="trash-2" size={20} color={theme.color.error} />
        </Pressable>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 160 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={80}
      >
        <IngredientEditorForm value={draft} onChange={setDraft} testIDPrefix="fridge" />

        <Text style={styles.label}>{t('fridge.editor.expiries')}</Text>
        <Text style={styles.sublabel}>{t('fridge.editor.expiriesSub')}</Text>

        {expiries.length === 0 ? (
          <Text style={styles.noExp}>{t('fridge.editor.noExpiries')}</Text>
        ) : null}

        {expiries.map((iso, i) => {
          const d = parseIso(iso);
          const days = daysUntil(iso);
          let fg = theme.color.brandSecondary;
          if (days < 0) fg = theme.color.error;
          else if (days <= 3) fg = theme.color.brand;
          return (
            <View key={`${iso}-${i}`} style={styles.expRow} testID={`exp-row-${i}`}>
              <Feather name="clock" size={16} color={fg} />
              <Pressable onPress={() => editExpiry(i)} style={{ flex: 1 }} testID={`exp-edit-${i}`}>
                <Text style={styles.expDate}>{d ? d.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' }) : iso}</Text>
                <Text style={[styles.expDays, { color: fg }]}>
                  {days < 0
                    ? t('expiry.expired', { n: -days })
                    : days === 0 ? t('expiry.today')
                    : days === 1 ? t('expiry.tomorrow')
                    : t('expiry.in', { n: days })}
                </Text>
              </Pressable>
              <Pressable onPress={() => removeExpiry(i)} hitSlop={12} testID={`exp-remove-${i}`}>
                <Feather name="x" size={18} color={theme.color.onSurfaceTertiary} />
              </Pressable>
            </View>
          );
        })}

        <Pressable onPress={addExpiry} style={styles.addBtn} testID="add-expiry">
          <Feather name="plus" size={16} color={theme.color.brandPrimary} />
          <Text style={styles.addBtnTxt}>{t('fridge.editor.addExpiry')}</Text>
        </Pressable>

        {err ? <Text style={styles.err}>{err}</Text> : null}
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={styles.saveWrap}>
          <Pressable onPress={save} disabled={busy} style={styles.saveBtn} testID="fridge-save">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>{t('common.save')}</Text>}
          </Pressable>
        </View>
      </KeyboardStickyView>

      {/* Date picker modal */}
      <Modal transparent visible={!!datePicking} animationType="fade" onRequestClose={() => setDatePicking(null)}>
        <Pressable style={styles.overlay} onPress={() => setDatePicking(null)}>
          <Pressable style={styles.dateCard} onPress={e => e.stopPropagation?.()}>
            <Text style={styles.modalH}>{t('expiry.set')}</Text>
            {Platform.OS === 'web' ? (
              <input
                type="date"
                value={datePicking?.value || todayIso()}
                onChange={(e: any) => setDatePicking(prev => prev ? { ...prev, value: e.target.value } : prev)}
                style={{
                  padding: 12, borderRadius: 8, borderWidth: 1,
                  borderColor: theme.color.border, fontSize: 16, marginTop: 12, marginBottom: 8, width: '100%',
                } as any}
              />
            ) : (
              <NativeDatePicker
                value={datePicking?.value || todayIso()}
                onChange={(v) => setDatePicking(prev => prev ? { ...prev, value: v } : prev)}
              />
            )}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
              <Pressable onPress={() => setDatePicking(null)} style={styles.btnGhost}>
                <Text style={styles.btnGhostTxt}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={() => datePicking && commitDate(datePicking.value)}
                style={styles.btnPrim}
                testID="date-confirm"
              >
                <Text style={styles.btnPrimTxt}>{t('common.save')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Delete confirmation */}
      <Modal transparent visible={showDelete} animationType="fade" onRequestClose={() => setShowDelete(false)}>
        <View style={styles.overlay}>
          <View style={styles.dateCard}>
            <Text style={styles.modalH}>{t('fridge.editor.confirmDelete')}</Text>
            <Text style={styles.modalP}>{t('fridge.editor.deleteBody')}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
              <Pressable onPress={() => setShowDelete(false)} style={styles.btnGhost}>
                <Text style={styles.btnGhostTxt}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable onPress={del} style={styles.btnDanger} testID="fridge-delete-confirm">
                <Text style={styles.btnDangerTxt}>{t('common.delete')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function NativeDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const now = new Date();
  const cur = value ? new Date(value) : now;
  const [y, setY] = useState(cur.getFullYear());
  const [m, setM] = useState(cur.getMonth());
  const [d, setD] = useState(cur.getDate());
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  useEffect(() => {
    const yy = y, mm = String(m + 1).padStart(2, '0'), dd = String(Math.min(d, daysInMonth)).padStart(2, '0');
    onChange(`${yy}-${mm}-${dd}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [y, m, d]);

  const yearOpts = Array.from({ length: 3 }, (_, i) => now.getFullYear() + i);
  const monthOpts = Array.from({ length: 12 }, (_, i) => i);
  const dayOpts = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <View style={{ flexDirection: 'row', marginTop: 12 }}>
      <PickerCol values={dayOpts} value={d} onChange={setD} format={n => String(n).padStart(2, '0')} width={70} />
      <PickerCol values={monthOpts} value={m} onChange={setM} format={n => new Date(2000, n, 1).toLocaleDateString('it-IT', { month: 'short' })} width={100} />
      <PickerCol values={yearOpts} value={y} onChange={setY} format={n => String(n)} width={80} />
    </View>
  );
}
function PickerCol<T>({ values, value, onChange, format, width }: { values: T[]; value: T; onChange: (v: T) => void; format: (v: T) => string; width: number }) {
  return (
    <ScrollView style={{ height: 160, width }} contentContainerStyle={{ alignItems: 'center', paddingVertical: 50 }}>
      {values.map((v, i) => {
        const active = v === value;
        return (
          <Pressable key={i} onPress={() => onChange(v)} style={{ paddingVertical: 6 }}>
            <Text style={{
              fontSize: active ? 18 : 14,
              color: active ? theme.color.brandPrimary : theme.color.onSurfaceSecondary,
              fontWeight: active ? '700' : '400',
            }}>
              {format(v)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  hBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hTitle: { flex: 1, textAlign: 'center', fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface },
  label: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.lg, marginBottom: 4, fontWeight: '500' },
  sublabel: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginBottom: 10 },
  noExp: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontStyle: 'italic', marginBottom: 6 },
  expRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.md, marginBottom: 8 },
  expDate: { fontSize: 14, color: theme.color.onSurface, fontWeight: '500' },
  expDays: { fontSize: 12, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, alignSelf: 'flex-start' },
  addBtnTxt: { color: theme.color.brandPrimary, fontWeight: '600', fontSize: 14 },
  err: { color: theme.color.error, fontSize: 13, marginTop: theme.spacing.md },
  saveWrap: { padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.color.divider, backgroundColor: theme.color.surface },
  saveBtn: { height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
  overlay: { flex: 1, backgroundColor: 'rgba(44,40,38,0.55)', alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  dateCard: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, padding: theme.spacing.xl, width: '100%', maxWidth: 380, borderWidth: 1, borderColor: theme.color.border },
  modalH: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface, marginBottom: 6 },
  modalP: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 18, marginTop: 6 },
  btnGhost: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  btnGhostTxt: { color: theme.color.onSurface, fontWeight: '500' },
  btnPrim: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  btnPrimTxt: { color: '#fff', fontWeight: '600' },
  btnDanger: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.error, alignItems: 'center', justifyContent: 'center' },
  btnDangerTxt: { color: '#fff', fontWeight: '600' },
});
