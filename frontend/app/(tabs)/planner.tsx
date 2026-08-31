import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { TipBanner } from '@/src/TipBanner';
import { TutorialKeys } from '@/src/tutorial';
import { useTranslation } from '@/src/i18n';
import {
  weekStartFor, addDays, isoDate, weekRangeLabel, todayIndexInWeek,
  orderedDayLabels, parseIso, weekStartLabels,
} from '@/src/week';

type SlotItem = { dish_id: string; dish_name: string; course: string; persons: number };
type Slot = { items: SlotItem[] };
type Plan = { week_start: string; slots: Record<string, Slot> };
type WeekRow = { week_start: string; count: number };

/** Extract items from a slot in either legacy or new shape. */
function itemsOf(slot: any): SlotItem[] {
  if (!slot) return [];
  if (Array.isArray(slot.items)) return slot.items;
  if (slot.dish_id) return [{
    dish_id: slot.dish_id,
    dish_name: slot.dish_name || '',
    course: slot.course || '',
    persons: slot.persons || 1,
  }];
  return [];
}

export default function Planner() {
  const { prefs } = useAuth();
  const { t, lang, locale, tCourse } = useTranslation();
  const MEALS: { key: 'pranzo' | 'cena'; label: string; icon: any }[] = [
    { key: 'pranzo', label: t('planner.pranzo'), icon: 'sun' },
    { key: 'cena', label: t('planner.cena'), icon: 'moon' },
  ];
  const startDay = prefs.week_start_day;
  const isBiweekly = prefs.planner_span === 'biweekly';
  const daysCount = isBiweekly ? 14 : 7;

  const dayLabelsFull = orderedDayLabels(startDay, true, lang);
  const weekSubLabel = weekStartLabels(startDay, lang);

  const [weekStart, setWeekStart] = useState(() => weekStartFor(new Date(), startDay));
  const [plan, setPlan] = useState<Plan | null>(null);       // first week
  const [plan2, setPlan2] = useState<Plan | null>(null);     // second week (only if biweekly)
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupTargetWeek, setDupTargetWeek] = useState<string>('');
  const [availableWeeks, setAvailableWeeks] = useState<WeekRow[]>([]);
  const [dupLoading, setDupLoading] = useState(false);
  const router = useRouter();

  const secondWeekStart = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const load = useCallback(async () => {
    try {
      const p = await api.getPlanner(isoDate(weekStart));
      setPlan(p);
      if (isBiweekly) {
        const p2 = await api.getPlanner(isoDate(secondWeekStart));
        setPlan2(p2);
      } else {
        setPlan2(null);
      }
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, [weekStart, isBiweekly, secondWeekStart]);

  useEffect(() => {
    setWeekStart(prev => weekStartFor(prev, startDay));
  }, [startDay]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const goWeek = (delta: number) => {
    Haptics.selectionAsync();
    // Jump by 7 or 14 days depending on span
    setWeekStart(prev => addDays(prev, delta * daysCount));
  };

  const today = todayIndexInWeek(weekStart);
  const todayInSecond = isBiweekly ? todayIndexInWeek(secondWeekStart) : null;

  const openSlot = (absDay: number, meal: 'pranzo' | 'cena') => {
    const inSecondWeek = absDay >= 7;
    const dayInWeek = inSecondWeek ? absDay - 7 : absDay;
    const targetPlan = inSecondWeek ? plan2 : plan;
    const targetWeekStart = inSecondWeek ? secondWeekStart : weekStart;
    const cur = targetPlan?.slots?.[`${dayInWeek}_${meal}`];
    const curItems = itemsOf(cur);
    router.push({
      pathname: '/planner-slot',
      params: {
        weekStart: isoDate(targetWeekStart),
        dayIndex: String(dayInWeek),
        meal,
        initialItems: JSON.stringify(curItems),
      },
    });
  };

  const duplicate = async (sourceWeek: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDuplicating(true);
    try {
      await api.duplicateWeek(sourceWeek, dupTargetWeek);
      await load();
      setDupOpen(false);
    } catch (e) {}
    setDuplicating(false);
  };

  const openDuplicatePicker = async (targetWeekIso: string) => {
    Haptics.selectionAsync();
    setDupTargetWeek(targetWeekIso);
    setDupOpen(true);
    setDupLoading(true);
    try {
      const rows = await api.listPlannerWeeks();
      setAvailableWeeks(rows.filter((r: WeekRow) => r.week_start !== targetWeekIso));
    } catch {}
    setDupLoading(false);
  };

  const dupPeriodLabel = useMemo(() => {
    if (!dupTargetWeek) return '';
    return weekRangeLabel(parseIso(dupTargetWeek), lang);
  }, [dupTargetWeek, lang]);

  const rangeLabel = useMemo(() => {
    if (!isBiweekly) return weekRangeLabel(weekStart, lang);
    const start = weekStart.toLocaleDateString(locale, { day: '2-digit', month: 'short' });
    const end = addDays(weekStart, 13).toLocaleDateString(locale, { day: '2-digit', month: 'short' });
    return `${start} – ${end}`;
  }, [weekStart, isBiweekly, lang, locale]);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="planner-screen">
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.h1}>{t('planner.title')}</Text>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => { Haptics.selectionAsync(); setWeekStart(weekStartFor(new Date(), startDay)); }}
              style={styles.headerIconBtn}
              testID="week-today"
            >
              <Feather name="calendar" size={16} color={theme.color.onSurface} />
              <Text style={styles.headerIconTxt}>{t('common.today')}</Text>
            </Pressable>
            <Pressable
              onPress={() => openDuplicatePicker(isoDate(weekStart))}
              disabled={duplicating}
              style={styles.headerIconBtn}
              testID="duplicate-week-button"
            >
              {duplicating ? (
                <ActivityIndicator size="small" color={theme.color.onSurface} />
              ) : (
                <Feather name="copy" size={16} color={theme.color.onSurface} />
              )}
            </Pressable>
            <Pressable onPress={() => router.push('/settings')} style={styles.headerIconBtn} testID="open-settings">
              <Feather name="settings" size={18} color={theme.color.onSurface} />
            </Pressable>
          </View>
        </View>
        <View style={styles.weekBar}>
          <Pressable testID="week-prev" onPress={() => goWeek(-1)} style={styles.weekBtn}>
            <Feather name="chevron-left" size={20} color={theme.color.onSurface} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.weekLabel}>{rangeLabel}</Text>
            <Text style={styles.weekSub}>
              {isBiweekly ? `${weekSubLabel} · ${t('planner.biweekly.suffix')}` : weekSubLabel}
            </Text>
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
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.brandPrimary} />}
        >
          <TipBanner
            storageKey={TutorialKeys.tipPlanner}
            icon="calendar"
            title={t('planner.tip.title')}
            body={t('planner.tip.body')}
            testID="tip-planner"
          />

          {Array.from({ length: daysCount }).map((_, i) => {
            const inSecondWeek = i >= 7;
            const dayInWeek = inSecondWeek ? i - 7 : i;
            const targetPlan = inSecondWeek ? plan2 : plan;
            const isToday = inSecondWeek ? todayInSecond === dayInWeek : today === dayInWeek;
            const d = addDays(weekStart, i);

            // Section divider between week 1 and week 2
            const showWeekDivider = isBiweekly && i === 7;

            return (
              <View key={i}>
                {showWeekDivider && (
                  <View style={styles.weekDivider} testID="week-2-divider">
                    <View style={styles.weekDividerLine} />
                    <Text style={styles.weekDividerTxt}>{t('planner.biweekly.week2', { range: weekRangeLabel(secondWeekStart, lang) })}</Text>
                    <View style={styles.weekDividerLine} />
                  </View>
                )}
                <View style={[styles.day, isToday && styles.dayToday]} testID={`day-${i}`}>
                  <View style={styles.dayHeader}>
                    <Text style={[styles.dayName, isToday && { color: theme.color.brandPrimary }]}>{dayLabelsFull[dayInWeek]}</Text>
                    <Text style={[styles.dayDate, isToday && { color: theme.color.brandPrimary }]}>
                      {d.getDate().toString().padStart(2, '0')}/{(d.getMonth() + 1).toString().padStart(2, '0')}
                      {isToday ? ` · ${t('planner.today.badge')}` : ''}
                    </Text>
                  </View>
                  {MEALS.map(m => {
                    const slot = targetPlan?.slots?.[`${dayInWeek}_${m.key}`];
                    const its = itemsOf(slot);
                    const filled = its.length > 0;
                    return (
                      <Pressable
                        key={m.key}
                        testID={`slot-${i}-${m.key}`}
                        onPress={() => openSlot(i, m.key)}
                        style={({ pressed }) => [styles.slot, filled && styles.slotFilled, pressed && { opacity: 0.9 }]}
                      >
                        <Feather name={m.icon} size={16} color={filled ? theme.color.brandSecondary : theme.color.onSurfaceTertiary} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.mealLabel}>{m.label}</Text>
                          {filled ? (
                            <>
                              {its.map((it, idx) => {
                                return (
                                  <View key={`${it.dish_id}_${idx}`} style={styles.itemLine}>
                                    <View style={styles.itemDot} />
                                    <Text style={styles.itemName} numberOfLines={1}>{it.dish_name}</Text>
                                    <Text style={styles.itemMeta}>{it.persons}p</Text>
                                  </View>
                                );
                              })}
                              {its.length === 1 && (
                                <Text style={styles.dishMeta}>
                                  {tCourse(prefs.courses.find(c => c.id === its[0].course)) || its[0].course}
                                </Text>
                              )}
                            </>
                          ) : (
                            <Text style={styles.slotEmpty}>{t('planner.slotEmpty')}</Text>
                          )}
                        </View>
                        <Feather name={filled ? 'edit-2' : 'plus'} size={16} color={theme.color.onSurfaceTertiary} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      <Modal
        transparent
        visible={dupOpen}
        animationType="fade"
        onRequestClose={() => setDupOpen(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.dupCard} testID="duplicate-picker-modal">
            <View style={styles.dupHeader}>
              <Text style={styles.dupTitle}>{t('planner.duplicate.title')}</Text>
              <Pressable onPress={() => setDupOpen(false)} testID="duplicate-close">
                <Feather name="x" size={22} color={theme.color.onSurface} />
              </Pressable>
            </View>
            <Text style={styles.dupSub}>
              {(() => {
                const raw = t('planner.duplicate.body', { week: '__WEEK__' });
                const [before, after] = raw.split('__WEEK__');
                return (
                  <>
                    {before}<Text style={{ fontWeight: '600' }}>{dupPeriodLabel}</Text>{after}
                    {isBiweekly ? t('planner.duplicate.bodyBiweekly') : ''}
                  </>
                );
              })()}
            </Text>
            {dupLoading ? (
              <View style={{ padding: theme.spacing.xl, alignItems: 'center' }}>
                <ActivityIndicator color={theme.color.brandPrimary} />
              </View>
            ) : availableWeeks.length === 0 ? (
              <View style={{ padding: theme.spacing.xl, alignItems: 'center' }}>
                <Feather name="calendar" size={32} color={theme.color.borderStrong} />
                <Text style={styles.dupEmpty}>{t('planner.duplicate.empty')}</Text>
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
                        <Text style={styles.dupRowT}>{weekRangeLabel(d, lang)}</Text>
                        <Text style={styles.dupRowS}>{t('planner.duplicate.rowMeta', { n: w.count, when: isPast ? t('planner.duplicate.past') : t('planner.duplicate.future') })}</Text>
                      </View>
                      <Feather name="copy" size={18} color={theme.color.onSurfaceTertiary} />
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            {isBiweekly ? (
              <View style={styles.dupSpanNote}>
                <Feather name="info" size={12} color={theme.color.onSurfaceTertiary} />
                <Text style={styles.dupSpanNoteTxt}>
                  {t('planner.biweekly.note')}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerIconBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 44, minWidth: 44, paddingHorizontal: 12, borderRadius: theme.radius.pill,
    justifyContent: 'center',
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
  },
  headerIconTxt: { fontSize: 12, color: theme.color.onSurface, fontWeight: '500' },
  h1: { fontFamily: theme.font.display, fontSize: 30, color: theme.color.onSurface },
  weekBar: { flexDirection: 'row', alignItems: 'center', marginTop: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: 6 },
  weekBtn: { width: 40, height: 40, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  weekLabel: { fontFamily: theme.font.display, fontSize: 16, color: theme.color.onSurface },
  weekSub: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  weekDivider: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    marginVertical: theme.spacing.md,
  },
  weekDividerLine: { flex: 1, height: 1, backgroundColor: theme.color.border },
  weekDividerTxt: {
    fontSize: 11, color: theme.color.brandPrimary, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
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
  slotFilled: { borderStyle: 'solid', backgroundColor: theme.color.surface, borderColor: theme.color.border, alignItems: 'flex-start' },
  mealLabel: { fontSize: 11, color: theme.color.onSurfaceTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  itemLine: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 1 },
  itemDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: theme.color.brandSecondary },
  itemName: { flex: 1, fontSize: 14, color: theme.color.onSurface, fontWeight: '500' },
  itemMeta: { fontSize: 11, color: theme.color.onSurfaceTertiary },
  dishName: { fontSize: 15, color: theme.color.onSurface, marginTop: 2, fontWeight: '500' },
  dishMeta: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  slotEmpty: { fontSize: 13, color: theme.color.onSurfaceTertiary, marginTop: 2 },
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
  dupSpanNote: { flexDirection: 'row', gap: 6, marginTop: theme.spacing.sm, paddingHorizontal: 4, alignItems: 'flex-start' },
  dupSpanNoteTxt: { flex: 1, fontSize: 11, color: theme.color.onSurfaceTertiary, lineHeight: 15 },
});
