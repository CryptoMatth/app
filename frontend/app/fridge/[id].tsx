import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Modal, Keyboard, Platform, ScrollView, TextInput, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import Feather from '@react-native-vector-icons/feather';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { useTranslation } from '@/src/i18n';
import { IngredientEditorForm, type IngredientDraft } from '@/src/IngredientEditorForm';
import type { ExpiryEntry } from '@/src/auth';

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
  const [expiries, setExpiries] = useState<ExpiryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [datePicking, setDatePicking] = useState<{ index: number | null; value: string; label: string } | null>(null);
  const isNew = !id || id === 'new';

  useEffect(() => {
    if (isNew) { setLoading(false); return; }
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
          // Backend now returns [{date,label}]; older data may be strings.
          const raw: any[] = it.expiries || [];
          const norm: ExpiryEntry[] = raw.map(e => (typeof e === 'string' ? { date: e, label: '' } : { date: e.date, label: e.label || '' }));
          norm.sort((a, b) => a.date.localeCompare(b.date));
          setExpiries(norm);
        }
      } catch {}
      setLoading(false);
    })();
  }, [id, isNew]);

  const save = async () => {
    Keyboard.dismiss();
    setErr('');
    if (!draft.name.trim()) { setErr(t('spesa.errors.name')); return; }
    const q = parseFloat((draft.quantity || '0').replace(',', '.'));
    if (isNaN(q) || q < 0) { setErr(t('spesa.errors.qty')); return; }
    setBusy(true);
    try {
      const payload = {
        name: draft.name.trim(),
        quantity: q,
        unit: draft.unit,
        notes: draft.notes || '',
        category_id: draft.category_id,
        photo_path: draft.photo_path || null,
        expiries: [...expiries].sort((a, b) => a.date.localeCompare(b.date)),
      };
      if (isNew) {
        await api.addFridge(payload);
      } else {
        await api.editFridge(id, payload);
      }
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
    setDatePicking({ index: null, value: def, label: '' });
  };
  const editExpiry = (i: number) => {
    setDatePicking({ index: i, value: expiries[i].date, label: expiries[i].label || '' });
  };
  const removeExpiry = (i: number) => {
    setExpiries(prev => prev.filter((_, idx) => idx !== i));
    Haptics.selectionAsync();
  };
  const commitDate = (iso: string, label: string) => {
    if (!datePicking) return;
    const entry: ExpiryEntry = { date: iso, label: label.trim() };
    if (datePicking.index === null) {
      // Allow multiple entries with the same date but different labels.
      setExpiries(prev => [...prev, entry].sort((a, b) => a.date.localeCompare(b.date)));
    } else {
      const arr = [...expiries]; arr[datePicking.index] = entry;
      setExpiries(arr.sort((a, b) => a.date.localeCompare(b.date)));
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
        <Text style={styles.hTitle}>{isNew ? t('fridge.editor.newTitle') : t('fridge.editor.title')}</Text>
        {isNew ? (
          <View style={styles.hBtn} />
        ) : (
          <Pressable onPress={() => setShowDelete(true)} style={styles.hBtn} testID="fridge-delete-btn">
            <Feather name="trash-2" size={20} color={theme.color.error} />
          </Pressable>
        )}
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

        {expiries.map((e, i) => {
          const iso = e.date;
          const label = e.label || '';
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
                {label ? <Text style={styles.expLabel} numberOfLines={1}>🏷️ {label}</Text> : null}
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

      {/* Date picker modal with optional label */}
      <Modal transparent visible={!!datePicking} animationType="fade" onRequestClose={() => setDatePicking(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.overlay}
        >
          <Pressable style={{ flex: 1, width: '100%' }} onPress={() => setDatePicking(null)} />
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
            <Text style={styles.smallLabel}>{t('expiry.labelOptional')}</Text>
            <TextInput
              value={datePicking?.label || ''}
              onChangeText={(text) => setDatePicking(prev => prev ? { ...prev, label: text } : prev)}
              placeholder={t('expiry.labelPh')}
              placeholderTextColor={theme.color.onSurfaceTertiary}
              maxLength={60}
              style={styles.labelInput}
              testID="exp-label-input"
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
              <Pressable onPress={() => setDatePicking(null)} style={styles.btnGhost}>
                <Text style={styles.btnGhostTxt}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={() => datePicking && commitDate(datePicking.value, datePicking.label || '')}
                style={styles.btnPrim}
                testID="date-confirm"
              >
                <Text style={styles.btnPrimTxt}>{t('common.save')}</Text>
              </Pressable>
            </View>
          </Pressable>
          <Pressable style={{ flex: 1, width: '100%' }} onPress={() => setDatePicking(null)} />
        </KeyboardAvoidingView>
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
  const parseVal = (s: string) => {
    const [yy, mm, dd] = s.split('-').map(Number);
    return { y: yy || new Date().getFullYear(), m: (mm || 1) - 1, d: dd || 1 };
  };
  const { y: initY, m: initM } = parseVal(value);
  const [viewY, setViewY] = useState(initY);
  const [viewM, setViewM] = useState(initM);

  const firstDay = new Date(viewY, viewM, 1);
  // Convert JS getDay() (0=Sunday..6=Saturday) into Mon=0..Sun=6 grid offset
  const jsDow = firstDay.getDay();
  const startOffset = (jsDow + 6) % 7;
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);
  while (cells.length % 7 !== 0) cells.push(null);

  const monthName = new Date(viewY, viewM, 1).toLocaleDateString(
    typeof navigator !== 'undefined' ? navigator.language : 'it',
    { month: 'long', year: 'numeric' },
  );
  const weekdays = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

  const goPrev = () => {
    if (viewM === 0) { setViewM(11); setViewY(y => y - 1); }
    else setViewM(m => m - 1);
    Haptics.selectionAsync();
  };
  const goNext = () => {
    if (viewM === 11) { setViewM(0); setViewY(y => y + 1); }
    else setViewM(m => m + 1);
    Haptics.selectionAsync();
  };

  const pick = (day: number) => {
    const iso = `${viewY}-${String(viewM + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    Haptics.selectionAsync();
    onChange(iso);
  };

  const { y: selY, m: selM, d: selD } = parseVal(value);
  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth();
  const todayD = today.getDate();

  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Pressable onPress={goPrev} hitSlop={12} style={{ padding: 6 }} testID="cal-prev">
          <Feather name="chevron-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.color.onSurface, textTransform: 'capitalize' }}>{monthName}</Text>
        <Pressable onPress={goNext} hitSlop={12} style={{ padding: 6 }} testID="cal-next">
          <Feather name="chevron-right" size={22} color={theme.color.onSurface} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        {weekdays.map((w, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: theme.color.onSurfaceTertiary }}>{w}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((day, i) => {
          if (day === null) {
            return <View key={i} style={{ width: `${100 / 7}%`, height: 40 }} />;
          }
          const isSelected = day === selD && viewM === selM && viewY === selY;
          const isToday = day === todayD && viewM === todayM && viewY === todayY;
          return (
            <View key={i} style={{ width: `${100 / 7}%`, height: 40, padding: 2 }}>
              <Pressable
                onPress={() => pick(day)}
                style={{
                  flex: 1, borderRadius: 8,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: isSelected ? theme.color.brandPrimary : (isToday ? theme.color.brandTertiary : 'transparent'),
                  borderWidth: isToday && !isSelected ? 1 : 0,
                  borderColor: theme.color.brandPrimary,
                }}
                testID={`cal-day-${day}`}
              >
                <Text style={{
                  fontSize: 14,
                  color: isSelected ? '#fff' : theme.color.onSurface,
                  fontWeight: isSelected || isToday ? '700' : '400',
                }}>{day}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
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
  expLabel: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 4, fontStyle: 'italic' },
  smallLabel: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 8, marginBottom: 4 },
  labelInput: {
    minHeight: 42, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    paddingHorizontal: theme.spacing.md, paddingVertical: 10, backgroundColor: theme.color.surfaceSecondary,
    color: theme.color.onSurface, fontSize: 14,
  },
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
