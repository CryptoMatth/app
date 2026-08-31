import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { orderedDayLabels } from '@/src/week';
import { useTranslation } from '@/src/i18n';

type Dish = { id: string; name: string; course: string; ingredients: any[] };
type Item = { dish_id: string; dish_name: string; course: string; persons: number };

export default function PlannerSlot() {
  const router = useRouter();
  const { prefs } = useAuth();
  const { t, lang, tCourse } = useTranslation();
  const courses = prefs.courses;
  const {
    weekStart, dayIndex, meal, initialItems,
  } = useLocalSearchParams<{
    weekStart: string; dayIndex: string; meal: 'pranzo' | 'cena';
    initialItems?: string;
  }>();

  // Selected items in composition tray
  const [items, setItems] = useState<Item[]>(() => {
    try { return initialItems ? JSON.parse(initialItems as string) as Item[] : []; }
    catch { return []; }
  });

  // Dish picker state
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>(courses[0]?.id || 'primo');
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const list = await api.listDishes({ course: tab, q: q || undefined });
        setDishes(list);
      } catch {}
      setLoading(false);
    })();
  }, [tab, q]);

  const dayLabel = orderedDayLabels(prefs.week_start_day, true, lang)[parseInt(dayIndex as string)] || '';

  const addDish = (d: Dish) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setItems(prev => {
      // If dish already in tray, increment its persons instead of duplicating
      const existingIdx = prev.findIndex(it => it.dish_id === d.id);
      if (existingIdx !== -1) {
        return prev.map((it, i) =>
          i === existingIdx ? { ...it, persons: it.persons + 1 } : it
        );
      }
      return [...prev, {
        dish_id: d.id,
        dish_name: d.name,
        course: d.course,
        persons: 1,
      }];
    });
  };

  const openDishDetails = (d: Dish) => {
    Haptics.selectionAsync();
    router.push(`/dish/${d.id}`);
  };

  const removeItem = (idx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const changePersons = (idx: number, delta: number) => {
    Haptics.selectionAsync();
    setItems(prev => prev.map((it, i) =>
      i === idx ? { ...it, persons: Math.max(1, it.persons + delta) } : it
    ));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSlot({
        week_start: weekStart,
        day_index: parseInt(dayIndex as string),
        meal,
        items: items.map(it => ({ dish_id: it.dish_id, persons: it.persons })),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch {}
    setSaving(false);
  };

  const usedIds = useMemo(() => new Set(items.map(i => i.dish_id)), [items]);
  const hasItems = items.length > 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="planner-slot-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.hBtn} testID="slot-back">
          <Feather name="x" size={22} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.hTitle}>{dayLabel}</Text>
          <Text style={styles.hSub}>{t('planner.slot.mealCount', { meal: meal === 'pranzo' ? t('planner.pranzo') : t('planner.cena'), n: items.length })}</Text>
        </View>
        <View style={styles.hBtn} />
      </View>

      {/* Composition tray */}
      <View style={styles.tray}>
        <View style={styles.trayHeader}>
          <Text style={styles.trayTitle}>{t('planner.slot.title')}</Text>
          <Text style={styles.trayHint}>{t('planner.slot.hint')}</Text>
        </View>

        {items.length === 0 ? (
          <View style={styles.trayEmpty}>
            <Feather name="inbox" size={22} color={theme.color.borderStrong} />
            <Text style={styles.trayEmptyTxt}>{t('planner.slot.empty')}</Text>
            <Text style={styles.trayEmptySub}>{t('planner.slot.emptySub')}</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.trayScroll}
          >
            {items.map((it, idx) => {
              const courseLabel = tCourse(courses.find(c => c.id === it.course)) || it.course;
              return (
                <View key={`${it.dish_id}_${idx}`} style={styles.itemCard} testID={`tray-item-${idx}`}>
                  <View style={styles.itemHead}>
                    <Text style={styles.itemCourse}>{courseLabel}</Text>
                    <Pressable onPress={() => removeItem(idx)} hitSlop={8} testID={`tray-remove-${idx}`}>
                      <Feather name="x" size={16} color={theme.color.onSurfaceTertiary} />
                    </Pressable>
                  </View>
                  <Text style={styles.itemName} numberOfLines={2}>{it.dish_name}</Text>
                  <View style={styles.itemPersons}>
                    <Pressable
                      onPress={() => changePersons(idx, -1)}
                      style={styles.pBtn} testID={`tray-minus-${idx}`}
                    >
                      <Feather name="minus" size={14} color={theme.color.onSurface} />
                    </Pressable>
                    <Text style={styles.pCount}>{it.persons}p</Text>
                    <Pressable
                      onPress={() => changePersons(idx, 1)}
                      style={styles.pBtn} testID={`tray-plus-${idx}`}
                    >
                      <Feather name="plus" size={14} color={theme.color.onSurface} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* Dish picker */}
      <View style={styles.searchBar}>
        <Feather name="search" size={16} color={theme.color.onSurfaceTertiary} />
        <TextInput
          testID="slot-search"
          value={q} onChangeText={setQ}
          placeholder={t('common.searchDish')}
          placeholderTextColor={theme.color.onSurfaceTertiary}
          style={styles.search}
        />
        {q.length > 0 && (
          <Pressable onPress={() => setQ('')} style={{ padding: 4 }} testID="slot-search-clear" hitSlop={8}>
            <Feather name="x-circle" size={18} color={theme.color.onSurfaceTertiary} />
          </Pressable>
        )}
      </View>

      <View style={styles.seg}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
          {courses.map(c => (
            <Pressable
              key={c.id}
              onPress={() => setTab(c.id)}
              style={[styles.segBtn, tab === c.id && styles.segBtnActive]}
              testID={`slot-seg-${c.id}`}
            >
              <Text style={[styles.segTxt, tab === c.id && styles.segTxtActive]}>{tCourse(c)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brandPrimary} /></View>
      ) : dishes.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTxt}>{t('planner.slot.emptyCategory')}</Text>
          <Text style={styles.emptySub}>{t('planner.slot.emptyCategorySub')}</Text>
        </View>
      ) : (
        <FlatList
          data={dishes}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120 }}
          renderItem={({ item: d }) => {
            const already = usedIds.has(d.id);
            const currentItem = items.find(it => it.dish_id === d.id);
            return (
              <View style={[styles.dishRow, already && styles.dishRowActive]}>
                <Pressable
                  testID={`open-dish-${d.id}`}
                  onPress={() => openDishDetails(d)}
                  style={{ flex: 1 }}
                >
                  <Text style={styles.dishName}>{d.name}</Text>
                  <Text style={styles.dishMeta}>
                    {already
                      ? t('planner.slot.dishesMetaWith', { n: d.ingredients?.length || 0, p: currentItem?.persons || 1 })
                      : t('planner.slot.dishesMeta', { n: d.ingredients?.length || 0 })}
                  </Text>
                </Pressable>
                <Pressable
                  testID={`add-dish-${d.id}`}
                  onPress={() => addDish(d)}
                  style={styles.addChip}
                  hitSlop={6}
                >
                  <Feather name="plus" size={16} color={theme.color.brandPrimary} />
                </Pressable>
              </View>
            );
          }}
          ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
        />
      )}

      <View style={styles.footer}>
        {hasItems ? (
          <Pressable onPress={() => setItems([])} style={styles.clearBtn} testID="slot-clear">
            <Feather name="trash-2" size={16} color={theme.color.error} />
            <Text style={styles.clearTxt}>{t('planner.slot.clear')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={save}
          disabled={saving}
          style={styles.saveBtn}
          testID="slot-save"
        >
          {saving ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.saveTxt}>
              {hasItems ? t('planner.slot.save', { n: items.length }) : t('planner.slot.saveEmpty')}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  hBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface },
  hSub: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },

  tray: {
    backgroundColor: theme.color.surfaceSecondary,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.color.divider,
  },
  trayHeader: { paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.sm },
  trayTitle: { fontFamily: theme.font.display, fontSize: 14, color: theme.color.onSurface },
  trayHint: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  trayEmpty: {
    alignItems: 'center', paddingVertical: theme.spacing.md, gap: 4,
  },
  trayEmptyTxt: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  trayEmptySub: { fontSize: 11, color: theme.color.onSurfaceTertiary },
  trayScroll: { paddingHorizontal: theme.spacing.lg, gap: 10, paddingVertical: 2 },
  itemCard: {
    width: 160, backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    padding: theme.spacing.sm, gap: 4,
  },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemCourse: {
    fontSize: 10, color: theme.color.brandPrimary, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  itemName: { fontSize: 13, color: theme.color.onSurface, fontWeight: '500', minHeight: 34 },
  itemPersons: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: theme.radius.pill, padding: 3,
    marginTop: 4, alignSelf: 'flex-start',
  },
  pBtn: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border,
    alignItems: 'center', justifyContent: 'center',
  },
  pCount: { fontFamily: theme.font.display, fontSize: 13, color: theme.color.onSurface, minWidth: 26, textAlign: 'center' },

  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, marginHorizontal: theme.spacing.lg, paddingHorizontal: theme.spacing.md, marginTop: theme.spacing.md, height: 44 },
  search: { flex: 1, fontSize: 15, color: theme.color.onSurface },
  seg: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, padding: 4, marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.md, minHeight: 42 },
  segBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.pill, paddingHorizontal: 16, paddingVertical: 8, minWidth: 80 },
  segBtnActive: { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  segTxt: { fontSize: 13, color: theme.color.onSurfaceSecondary },
  segTxtActive: { color: theme.color.brandPrimary, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.xl },
  emptyTxt: { fontSize: 15, color: theme.color.onSurfaceSecondary },
  emptySub: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 4 },
  dishRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: theme.spacing.md,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  dishRowActive: { borderColor: theme.color.brandSecondary, backgroundColor: '#E5EDDF' },
  dishName: { fontFamily: theme.font.display, fontSize: 16, color: theme.color.onSurface },
  dishMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  addChip: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: theme.color.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  footer: { flexDirection: 'row', gap: 10, padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.color.divider, backgroundColor: theme.color.surface },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: theme.spacing.lg, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.border },
  clearTxt: { color: theme.color.error, fontWeight: '500' },
  saveBtn: { flex: 1, height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
