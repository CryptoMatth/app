import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import {
  saturdayOf, addDays, isoDate, weekRangeLabel, todayIndexInWeek, DAY_LABELS, DAY_LABELS_FULL, parseIso,
} from '@/src/week';

type Slot = { dish_id: string; dish_name: string; course: 'primo' | 'secondo'; persons: number };
type Plan = { week_start: string; slots: Record<string, Slot> };
type WeekRow = { week_start: string; count: number };

const MEALS: { key: 'pranzo' | 'cena'; label: string; icon: any }[] = [
  { key: 'pranzo', label: 'Pranzo', icon: 'sun' },
  { key: 'cena', label: 'Cena', icon: 'moon' },
];

export default function Planner() {
  const [weekStart, setWeekStart] = useState(() => saturdayOf(new Date()));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [availableWeeks, setAvailableWeeks] = useState<WeekRow[]>([]);
  const [dupLoading, setDupLoading] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const p = await api.getPlanner(isoDate(weekStart));
      setPlan(p);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, [weekStart]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const goWeek = (delta: number) => {
    Haptics.selectionAsync();
    setWeekStart(prev => addDays(prev, delta * 7));
  };

  const today = todayIndexInWeek(weekStart);

  const openSlot = (dayIndex: number, meal: 'pranzo' | 'cena') => {
    const slotKey = `${dayIndex}_${meal}`;
    const cur = plan?.slots?.[slotKey];
    router.push({
      pathname: '/planner-slot',
      params: {
        weekStart: isoDate(weekStart),
        dayIndex: String(dayIndex),
        meal,
        currentDishId: cur?.dish_id || '',
        currentPersons: String(cur?.persons || 2),
      },
    });
  };

  const duplicate = async (sourceWeek: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDuplicating(true);
    try {
      await api.duplicateWeek(sourceWeek, isoDate(weekStart));
      await load();
      setDupOpen(false);
    } catch (e) {}
    setDuplicating(false);
  };

  const openDuplicatePicker = async () => {
    Haptics.selectionAsync();
    setDupOpen(true);
    setDupLoading(true);
    try {
      const rows = await api.listPlannerWeeks();
      // Exclude the current week itself
      const current = isoDate(weekStart);
      setAvailableWeeks(rows.filter((r: WeekRow) => r.week_start !== current));
    } catch {}
    setDupLoading(false);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="planner-screen">
      <View style={styles.header}>
        <Text style={styles.h1}>Planner</Text>
        <View style={styles.weekBar}>
          <Pressable testID="week-prev" onPress={() => goWeek(-1)} style={styles.weekBtn}>
            <Feather name="chevron-left" size={20} color={theme.color.onSurface} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.weekLabel}>{weekRangeLabel(weekStart)}</Text>
            <Text style={styles.weekSub}>sab → ven</Text>
          </View>
          <Pressable testID="week-next" onPress={() => goWeek(1)} style={styles.weekBtn}>
            <Feather name="chevron-right" size={20} color={theme.color.onSurface} />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 140 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.brandPrimary} />}
        >
          {Array.from({ length: 7 }).map((_, i) => {
            const isToday = today === i;
            const d = addDays(weekStart, i);
            return (
              <View key={i} style={[styles.day, isToday && styles.dayToday]} testID={`day-${i}`}>
                <View style={styles.dayHeader}>
                  <Text style={[styles.dayName, isToday && { color: theme.color.brandPrimary }]}>{DAY_LABELS_FULL[i]}</Text>
                  <Text style={[styles.dayDate, isToday && { color: theme.color.brandPrimary }]}>
                    {d.getDate().toString().padStart(2, '0')}/{(d.getMonth() + 1).toString().padStart(2, '0')}
                    {isToday ? ' · oggi' : ''}
                  </Text>
                </View>
                {MEALS.map(m => {
                  const slot = plan?.slots?.[`${i}_${m.key}`];
                  return (
                    <Pressable
                      key={m.key}
                      testID={`slot-${i}-${m.key}`}
                      onPress={() => openSlot(i, m.key)}
                      style={({ pressed }) => [styles.slot, slot && styles.slotFilled, pressed && { opacity: 0.9 }]}
                    >
                      <Feather name={m.icon} size={16} color={slot ? theme.color.brandSecondary : theme.color.onSurfaceTertiary} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.mealLabel}>{m.label}</Text>
                        {slot ? (
                          <>
                            <Text style={styles.dishName}>{slot.dish_name}</Text>
                            <Text style={styles.dishMeta}>{slot.persons} pers. · {slot.course === 'primo' ? 'Primo' : 'Secondo'}</Text>
                          </>
                        ) : (
                          <Text style={styles.slotEmpty}>Tocca per aggiungere un piatto</Text>
                        )}
                      </View>
                      <Feather name={slot ? 'edit-2' : 'plus'} size={16} color={theme.color.onSurfaceTertiary} />
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
      )}

      <Pressable
        testID="duplicate-week-button"
        onPress={openDuplicatePicker}
        disabled={duplicating}
        style={({ pressed }) => [styles.duplicate, pressed && { opacity: 0.9 }]}
      >
        {duplicating ? <ActivityIndicator color="#fff" /> : (
          <>
            <Feather name="copy" size={16} color="#fff" />
            <Text style={styles.duplicateTxt}>Duplica una settimana</Text>
          </>
        )}
      </Pressable>

      <Modal
        transparent
        visible={dupOpen}
        animationType="fade"
        onRequestClose={() => setDupOpen(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.dupCard} testID="duplicate-picker-modal">
            <View style={styles.dupHeader}>
              <Text style={styles.dupTitle}>Duplica una settimana</Text>
              <Pressable onPress={() => setDupOpen(false)} testID="duplicate-close">
                <Feather name="x" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
            <Text style={styles.dupSub}>
              Scegli quale settimana copiare in <Text style={{ fontWeight: '600' }}>{weekRangeLabel(weekStart)}</Text>.
            </Text>
            {dupLoading ? (
              <View style={{ padding: theme.spacing.xl, alignItems: 'center' }}>
                <ActivityIndicator color={theme.color.brandPrimary} />
              </View>
            ) : availableWeeks.length === 0 ? (
              <View style={{ padding: theme.spacing.xl, alignItems: 'center' }}>
                <Feather name="calendar" size={32} color={theme.color.borderStrong} />
                <Text style={styles.dupEmpty}>Non hai ancora settimane pianificate da copiare.</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 320 }}>
                {availableWeeks.map(w => {
                  const d = parseIso(w.week_start);
                  const isPast = d.getTime() < weekStart.getTime();
                  return (
                    <Pressable
                      key={w.week_start}
                      onPress={() => duplicate(w.week_start)}
                      disabled={duplicating}
                      style={styles.dupRow}
                      testID={`duplicate-src-${w.week_start}`}
                    >
                      <View style={[styles.dupIcon, { backgroundColor: isPast ? theme.color.brandTertiary : '#E5EDDF' }]}>
                        <Feather name={isPast ? 'clock' : 'chevron-right'} size={16} color={isPast ? theme.color.brandPrimary : theme.color.brandSecondary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.dupRowT}>{weekRangeLabel(d)}</Text>
                        <Text style={styles.dupRowS}>{w.count} pasti · {isPast ? 'settimana passata' : 'settimana futura'}</Text>
                      </View>
                      <Feather name="copy" size={18} color={theme.color.onSurfaceTertiary} />
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  h1: { fontFamily: theme.font.display, fontSize: 30, color: theme.color.onSurface },
  weekBar: { flexDirection: 'row', alignItems: 'center', marginTop: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: 6 },
  weekBtn: { width: 40, height: 40, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  weekLabel: { fontFamily: theme.font.display, fontSize: 16, color: theme.color.onSurface },
  weekSub: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  day: { borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.md, backgroundColor: theme.color.surface },
  dayToday: { borderColor: theme.color.brandPrimary, borderWidth: 2, backgroundColor: theme.color.surfaceSecondary },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: theme.spacing.sm },
  dayName: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface },
  dayDate: { fontSize: 12, color: theme.color.onSurfaceTertiary },
  slot: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    paddingVertical: theme.spacing.md, paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.color.divider, borderStyle: 'dashed',
    marginBottom: theme.spacing.sm, backgroundColor: theme.color.surface,
  },
  slotFilled: { borderStyle: 'solid', backgroundColor: theme.color.surface, borderColor: theme.color.border },
  mealLabel: { fontSize: 11, color: theme.color.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  dishName: { fontSize: 15, color: theme.color.onSurface, marginTop: 2, fontWeight: '500' },
  dishMeta: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  slotEmpty: { fontSize: 13, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  duplicate: {
    position: 'absolute', left: theme.spacing.lg, right: theme.spacing.lg, bottom: theme.spacing.lg,
    backgroundColor: theme.color.brandPrimary, borderRadius: theme.radius.pill,
    paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  duplicateTxt: { color: '#fff', fontWeight: '600', fontSize: 15 },
  overlay: { flex: 1, backgroundColor: 'rgba(44,40,38,0.55)', alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  dupCard: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, width: '100%', maxWidth: 420, borderWidth: 1, borderColor: theme.color.border, padding: theme.spacing.lg },
  dupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  dupTitle: { fontFamily: theme.font.display, fontSize: 20, color: theme.color.onSurface },
  dupSub: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 18, marginBottom: theme.spacing.md },
  dupRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.md, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface, marginBottom: theme.spacing.sm },
  dupIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dupRowT: { fontFamily: theme.font.display, fontSize: 15, color: theme.color.onSurface },
  dupRowS: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  dupEmpty: { fontSize: 13, color: theme.color.onSurfaceTertiary, marginTop: 8, textAlign: 'center' },
});
