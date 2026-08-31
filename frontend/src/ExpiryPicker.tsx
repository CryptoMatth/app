/**
 * Expiration date picker with Pro-gating.
 *
 * Uses a lightweight day-offset chooser (Today / +1d / +3d / +7d / +14d / custom).
 * Custom date uses HTML input on web and a scrollable list on native.
 * Values are stored as ISO date strings (YYYY-MM-DD).
 */
import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { theme } from './theme';
import { useTranslation } from './i18n';
import { useIsPro, ProUpsellModal } from './ProGate';

type Props = {
  value?: string | null; // YYYY-MM-DD
  onChange: (v: string | null) => void;
};

const PRESETS = [
  { key: 't', addDays: 0 },
  { key: '1', addDays: 1 },
  { key: '3', addDays: 3 },
  { key: '7', addDays: 7 },
  { key: '14', addDays: 14 },
  { key: '30', addDays: 30 },
];

function toIso(d: Date): string {
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

function daysBetween(a: Date, b: Date): number {
  const day = 1000 * 60 * 60 * 24;
  const na = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const nb = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((na - nb) / day);
}

export function ExpiryPicker({ value, onChange }: Props) {
  const { t, locale } = useTranslation();
  const isPro = useIsPro();
  const [upsell, setUpsell] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const parsed = parseIso(value);
  const label = useMemo(() => {
    if (!parsed) return null;
    return parsed.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
  }, [parsed, locale]);

  const gated = (fn: () => void) => () => {
    if (!isPro) { setUpsell(true); return; }
    fn();
  };

  const selectOffset = (addDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + addDays);
    Haptics.selectionAsync();
    onChange(toIso(d));
  };

  return (
    <View style={{ marginTop: theme.spacing.md }}>
      <View style={styles.headerRow}>
        <Feather name="clock" size={14} color={theme.color.onSurfaceSecondary} />
        <Text style={styles.label}>{t('expiry.h')}</Text>
        {!isPro && (
          <View style={styles.proBadge}>
            <Feather name="lock" size={9} color="#fff" />
            <Text style={styles.proBadgeTxt}>PRO</Text>
          </View>
        )}
        {value ? (
          <Pressable onPress={() => onChange(null)} style={styles.clearBtn} testID="expiry-clear">
            <Feather name="x" size={12} color={theme.color.error} />
            <Text style={styles.clearTxt}>{t('expiry.clear')}</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {PRESETS.map(p => {
          const d = new Date(); d.setDate(d.getDate() + p.addDays);
          const iso = toIso(d);
          const active = value === iso;
          const lbl = p.addDays === 0 ? t('common.today') : `+${p.addDays}g`;
          return (
            <Pressable
              key={p.key}
              onPress={gated(() => selectOffset(p.addDays))}
              style={[styles.chip, active && styles.chipActive]}
              testID={`expiry-${p.key}`}
            >
              <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{lbl}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={gated(() => setCustomOpen(true))}
          style={[styles.chip, !!label && !PRESETS.some(p => {
            const d = new Date(); d.setDate(d.getDate() + p.addDays);
            return toIso(d) === value;
          }) && styles.chipActive]}
          testID="expiry-custom"
        >
          <Feather name="calendar" size={13} color={theme.color.onSurface} />
          <Text style={[styles.chipTxt, { marginLeft: 4 }]}>{label && !PRESETS.some(p => { const d = new Date(); d.setDate(d.getDate() + p.addDays); return toIso(d) === value; }) ? label : '···'}</Text>
        </Pressable>
      </ScrollView>

      <CustomDateModal
        open={customOpen}
        value={value || null}
        onClose={() => setCustomOpen(false)}
        onPick={(iso) => { onChange(iso); setCustomOpen(false); }}
      />
      <ProUpsellModal open={upsell} onClose={() => setUpsell(false)} feature="expiry" />
    </View>
  );
}

function CustomDateModal({ open, value, onClose, onPick }: {
  open: boolean; value: string | null;
  onClose: () => void; onPick: (iso: string) => void;
}) {
  const { t, locale } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(parseIso(value)?.getFullYear() || now.getFullYear());
  const [month, setMonth] = useState((parseIso(value)?.getMonth() ?? now.getMonth()));
  const [day, setDay] = useState(parseIso(value)?.getDate() || now.getDate());

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const yearOptions = Array.from({ length: 4 }, (_, i) => now.getFullYear() + i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i);
  const dayOptions = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const monthName = (m: number) => new Date(2000, m, 1).toLocaleDateString(locale, { month: 'long' });

  const confirm = () => {
    const clamped = Math.min(day, daysInMonth);
    const d = new Date(year, month, clamped);
    onPick(toIso(d));
  };

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
      <Pressable style={dstyles.overlay} onPress={onClose}>
        <Pressable style={dstyles.card} onPress={e => e.stopPropagation?.()}>
          <Text style={dstyles.title}>{t('expiry.set')}</Text>
          {Platform.OS === 'web' ? (
            <input
              type="date"
              value={value || toIso(new Date(year, month, day))}
              min={toIso(new Date())}
              onChange={(e: any) => {
                if (e.target.value) onPick(e.target.value);
              }}
              style={{
                padding: 12, borderRadius: 8, borderWidth: 1,
                borderColor: theme.color.border, fontSize: 15,
                marginTop: 12, marginBottom: 8, width: '100%',
              } as any}
            />
          ) : (
            <View style={dstyles.pickers}>
              <PickerCol values={dayOptions} value={day} onChange={setDay} format={(d) => String(d).padStart(2, '0')} />
              <PickerCol values={monthOptions} value={month} onChange={setMonth} format={monthName} width={140} />
              <PickerCol values={yearOptions} value={year} onChange={setYear} format={(y) => String(y)} />
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
            <Pressable onPress={onClose} style={dstyles.btnGhost}>
              <Text style={dstyles.btnGhostTxt}>{t('common.cancel')}</Text>
            </Pressable>
            {Platform.OS !== 'web' && (
              <Pressable onPress={confirm} style={dstyles.btnPrim} testID="expiry-confirm">
                <Text style={dstyles.btnPrimTxt}>{t('common.save')}</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PickerCol<T>({ values, value, onChange, format, width = 80 }:
  { values: T[]; value: T; onChange: (v: T) => void; format: (v: T) => string; width?: number }) {
  return (
    <ScrollView style={{ height: 180, width }} contentContainerStyle={{ alignItems: 'center', paddingVertical: 60 }}>
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

/** Small badge shown in the shopping-list row for items with an expiration set.
 *  Colors: red if expired, orange if <=3d, green otherwise. */
export function ExpiryBadge({ iso }: { iso?: string | null }) {
  const { t } = useTranslation();
  if (!iso) return null;
  const d = parseIso(iso);
  if (!d) return null;
  const days = daysBetween(d, new Date());
  let label = '';
  let bg = '';
  let fg = '';
  if (days < 0) { label = days === -1 ? t('expiry.expiredToday') : t('expiry.expired', { n: -days }); bg = '#F5E0DC'; fg = theme.color.error; }
  else if (days === 0) { label = t('expiry.today'); bg = '#FDE2CE'; fg = theme.color.brand; }
  else if (days === 1) { label = t('expiry.tomorrow'); bg = '#FDE2CE'; fg = theme.color.brand; }
  else if (days <= 3) { label = t('expiry.in', { n: days }); bg = '#FDE2CE'; fg = theme.color.brand; }
  else { label = t('expiry.in', { n: days }); bg = '#E5EDDF'; fg = theme.color.brandSecondary; }
  return (
    <View style={[bStyles.badge, { backgroundColor: bg }]}>
      <Feather name="clock" size={10} color={fg} />
      <Text style={[bStyles.txt, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  label: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  proBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 10, backgroundColor: theme.color.brand,
  },
  proBadgeTxt: { color: '#fff', fontWeight: '700', fontSize: 9 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto' },
  clearTxt: { color: theme.color.error, fontSize: 12 },
  row: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  chipActive: { backgroundColor: theme.color.brandTertiary, borderColor: theme.color.brandPrimary },
  chipTxt: { fontSize: 13, color: theme.color.onSurface },
  chipTxtActive: { color: theme.color.brandPrimary, fontWeight: '600' },
});

const dstyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(44,40,38,0.55)', alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  card: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, padding: theme.spacing.xl, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: theme.color.border },
  title: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface, marginBottom: 6 },
  pickers: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color.border },
  btnGhost: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  btnGhostTxt: { color: theme.color.onSurface, fontWeight: '500' },
  btnPrim: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  btnPrimTxt: { color: '#fff', fontWeight: '600' },
});

const bStyles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, alignSelf: 'flex-start', marginTop: 3 },
  txt: { fontSize: 11, fontWeight: '600' },
});
