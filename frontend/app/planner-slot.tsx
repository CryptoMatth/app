import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { DAY_LABELS_FULL } from '@/src/week';

type Dish = { id: string; name: string; course: 'primo' | 'secondo'; ingredients: any[] };

export default function PlannerSlot() {
  const router = useRouter();
  const { weekStart, dayIndex, meal, currentDishId, currentPersons } =
    useLocalSearchParams<{ weekStart: string; dayIndex: string; meal: 'pranzo' | 'cena'; currentDishId?: string; currentPersons?: string }>();

  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'primo' | 'secondo'>('primo');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>((currentDishId as string) || null);
  const [persons, setPersons] = useState<number>(parseInt((currentPersons as string) || '2') || 2);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listDishes({ course: tab, q: q || undefined });
        setDishes(list);
      } catch {}
      setLoading(false);
    })();
  }, [tab, q]);

  const save = async (dishId: string | null) => {
    setSaving(true);
    try {
      await api.updateSlot({
        week_start: weekStart,
        day_index: parseInt(dayIndex as string),
        meal,
        dish_id: dishId,
        persons,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.back();
    } catch {}
    setSaving(false);
  };

  const dayLabel = DAY_LABELS_FULL[parseInt(dayIndex as string)] || '';

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="planner-slot-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.hBtn} testID="slot-back">
          <Feather name="x" size={22} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.hTitle}>{dayLabel}</Text>
          <Text style={styles.hSub}>{meal === 'pranzo' ? 'Pranzo' : 'Cena'}</Text>
        </View>
        <View style={styles.hBtn} />
      </View>

      <View style={styles.personsRow}>
        <Text style={styles.personsLabel}>Persone:</Text>
        <View style={styles.personsCtl}>
          <Pressable onPress={() => setPersons(p => Math.max(1, p - 1))} style={styles.personsBtn} testID="persons-minus">
            <Feather name="minus" size={18} color={theme.color.onSurface} />
          </Pressable>
          <Text style={styles.personsCount} testID="persons-count">{persons}</Text>
          <Pressable onPress={() => setPersons(p => p + 1)} style={styles.personsBtn} testID="persons-plus">
            <Feather name="plus" size={18} color={theme.color.onSurface} />
          </Pressable>
        </View>
      </View>

      <View style={styles.searchBar}>
        <Feather name="search" size={16} color={theme.color.onSurfaceTertiary} />
        <TextInput
          testID="slot-search"
          value={q} onChangeText={setQ}
          placeholder="Cerca piatto..."
          placeholderTextColor={theme.color.onSurfaceTertiary}
          style={styles.search}
        />
      </View>

      <View style={styles.seg}>
        {(['primo', 'secondo'] as const).map(c => (
          <Pressable key={c} onPress={() => setTab(c)} style={[styles.segBtn, tab === c && styles.segBtnActive]} testID={`slot-seg-${c}`}>
            <Text style={[styles.segTxt, tab === c && styles.segTxtActive]}>{c === 'primo' ? 'Primi' : 'Secondi'}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brandPrimary} /></View>
      ) : dishes.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTxt}>Nessun piatto in questa categoria.</Text>
          <Text style={styles.emptySub}>Aggiungilo prima nel tab Piatti.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120 }}>
          {dishes.map(d => (
            <Pressable
              key={d.id}
              testID={`select-dish-${d.id}`}
              onPress={() => setSelected(d.id)}
              style={[styles.dishRow, selected === d.id && styles.dishRowActive]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.dishName}>{d.name}</Text>
                <Text style={styles.dishMeta}>{d.ingredients?.length || 0} ingredienti</Text>
              </View>
              {selected === d.id && <Feather name="check" size={20} color={theme.color.brandPrimary} />}
            </Pressable>
          ))}
        </ScrollView>
      )}

      <View style={styles.footer}>
        {currentDishId ? (
          <Pressable onPress={() => save(null)} style={styles.clearBtn} testID="slot-clear">
            <Feather name="trash-2" size={16} color={theme.color.error} />
            <Text style={styles.clearTxt}>Rimuovi</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => selected && save(selected)}
          disabled={!selected || saving}
          style={[styles.saveBtn, !selected && { opacity: 0.5 }]}
          testID="slot-save"
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Salva</Text>}
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
  personsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  personsLabel: { fontSize: 14, color: theme.color.onSurface, fontWeight: '500' },
  personsCtl: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, padding: 4 },
  personsBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  personsCount: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface, minWidth: 32, textAlign: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, marginHorizontal: theme.spacing.lg, paddingHorizontal: theme.spacing.md, marginTop: theme.spacing.md, height: 44 },
  search: { flex: 1, fontSize: 15, color: theme.color.onSurface },
  seg: { flexDirection: 'row', backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, padding: 4, marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.md, height: 42 },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.pill },
  segBtnActive: { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  segTxt: { fontSize: 13, color: theme.color.onSurfaceSecondary },
  segTxtActive: { color: theme.color.brandPrimary, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.xl },
  emptyTxt: { fontSize: 15, color: theme.color.onSurfaceSecondary },
  emptySub: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 4 },
  dishRow: { flexDirection: 'row', alignItems: 'center', padding: theme.spacing.md, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface, marginBottom: theme.spacing.sm },
  dishRowActive: { borderColor: theme.color.brandPrimary, borderWidth: 2, backgroundColor: theme.color.surfaceSecondary },
  dishName: { fontFamily: theme.font.display, fontSize: 16, color: theme.color.onSurface },
  dishMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  footer: { flexDirection: 'row', gap: 10, padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.color.divider, backgroundColor: theme.color.surface },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: theme.spacing.lg, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.border },
  clearTxt: { color: theme.color.error, fontWeight: '500' },
  saveBtn: { flex: 1, height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
