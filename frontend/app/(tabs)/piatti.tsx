import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, FlatList, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';

type Dish = { id: string; name: string; course: 'primo' | 'secondo'; ingredients: any[]; preparation: string; servings: number };

export default function Piatti() {
  const [tab, setTab] = useState<'primo' | 'secondo'>('primo');
  const [q, setQ] = useState('');
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();
  const { user } = useAuth();

  const load = useCallback(async () => {
    try {
      const list = await api.listDishes({ course: tab, q: q || undefined });
      setDishes(list);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab, q]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="piatti-screen">
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.h1}>Piatti</Text>
            <Text style={styles.sub}>Il tuo ricettario personale</Text>
          </View>
          <Pressable onPress={() => router.push('/settings')} style={styles.logoutBtn} testID="open-settings">
            <Feather name="settings" size={18} color={theme.color.onSurfaceSecondary} />
          </Pressable>
        </View>

        <View style={styles.searchWrap}>
          <Feather name="search" size={16} color={theme.color.onSurfaceTertiary} />
          <TextInput
            testID="piatti-search"
            placeholder="Cerca un piatto..."
            placeholderTextColor={theme.color.onSurfaceTertiary}
            value={q}
            onChangeText={setQ}
            style={styles.search}
          />
          {q.length > 0 && (
            <Pressable onPress={() => setQ('')} style={styles.clearBtn} testID="piatti-search-clear" hitSlop={8}>
              <Feather name="x-circle" size={18} color={theme.color.onSurfaceTertiary} />
            </Pressable>
          )}
        </View>

        <View style={styles.seg}>
          {(['primo', 'secondo'] as const).map(c => (
            <Pressable
              key={c}
              testID={`segment-${c}`}
              onPress={() => setTab(c)}
              style={[styles.segBtn, tab === c && styles.segBtnActive]}
            >
              <Text style={[styles.segTxt, tab === c && styles.segTxtActive]}>
                {c === 'primo' ? 'Primi' : 'Secondi'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brandPrimary} /></View>
      ) : dishes.length === 0 ? (
        <View style={styles.center}>
          <Feather name="book-open" size={44} color={theme.color.borderStrong} />
          <Text style={styles.emptyH}>Nessun piatto</Text>
          <Text style={styles.emptyP}>Aggiungi la tua prima ricetta con il pulsante in basso.</Text>
        </View>
      ) : (
        <FlatList
          data={dishes}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.brandPrimary} />}
          renderItem={({ item }) => (
            <Pressable
              testID={`dish-card-${item.id}`}
              onPress={() => router.push(`/dish/${item.id}`)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text style={styles.cardMeta}>
                  {item.ingredients?.length || 0} ingredienti · {item.servings} porz.
                </Text>
              </View>
              <Feather name="chevron-right" size={22} color={theme.color.onSurfaceTertiary} />
            </Pressable>
          )}
          ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
        />
      )}

      <Pressable
        testID="add-dish-fab"
        onPress={() => router.push(`/dish/new?course=${tab}`)}
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.9 }]}
      >
        <Feather name="plus" size={22} color="#fff" />
        <Text style={styles.fabTxt}>Nuovo piatto</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider, backgroundColor: theme.color.surface },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h1: { fontFamily: theme.font.display, fontSize: 30, color: theme.color.onSurface },
  sub: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  logoutBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surfaceSecondary },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md, marginTop: theme.spacing.md, height: 44,
  },
  search: { flex: 1, fontSize: 15, color: theme.color.onSurface, paddingVertical: 0 },
  clearBtn: { padding: 4 },
  seg: { flexDirection: 'row', backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, padding: 4, marginTop: theme.spacing.md, height: 44 },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.pill },
  segBtnActive: { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  segTxt: { fontSize: 14, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  segTxtActive: { color: theme.color.brandPrimary, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl, gap: 8 },
  emptyH: { fontFamily: theme.font.display, fontSize: 20, color: theme.color.onSurface, marginTop: 8 },
  emptyP: { fontSize: 13, color: theme.color.onSurfaceSecondary, textAlign: 'center' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: theme.spacing.lg,
    borderWidth: 1, borderColor: theme.color.border,
  },
  cardTitle: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface },
  cardMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  fab: {
    position: 'absolute', right: theme.spacing.lg, bottom: theme.spacing.lg,
    backgroundColor: theme.color.brandPrimary, borderRadius: theme.radius.pill,
    paddingVertical: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  fabTxt: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
