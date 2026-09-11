import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList, RefreshControl, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { useTranslation } from '@/src/i18n';
import { PhotoThumb } from '@/src/PhotoPicker';
import { useHasTier, ProUpsellModal } from '@/src/ProGate';

type FridgeItem = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  category_id?: string;
  photo_path?: string | null;
  notes?: string;
  expiries: string[]; // ISO
  created_at?: string;
};

function parseIso(s: string): Date | null {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function daysUntil(iso: string): number {
  const d = parseIso(iso); if (!d) return Number.NaN;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
}

export default function Frigorifero() {
  const router = useRouter();
  const { t, tCat, locale } = useTranslation();
  const { prefs } = useAuth();
  const isPro = useHasTier('pro_plus');
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<FridgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [upsell, setUpsell] = useState(false);

  const catById = useMemo(() => {
    const m: Record<string, any> = {};
    prefs.ingredient_categories.forEach(c => { m[c.id] = c; });
    return m;
  }, [prefs]);

  const load = useCallback(async () => {
    if (!isPro) { setLoading(false); return; }
    try {
      const list = await api.listFridge();
      setItems(list);
    } catch {}
    setLoading(false);
  }, [isPro]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
    Haptics.selectionAsync();
  }, [load]);

  const del = async (id: string) => {
    try {
      await api.deleteFridge(id);
      setItems(prev => prev.filter(x => x.id !== id));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch {}
  };

  // Group items by status: expired (impossible thanks to auto-cleanup but keep guard), expiring soon, ok, no-date.
  // Within each section, sort ascending by earliest expiry so items closer to expiring
  // appear first.
  const sections = useMemo(() => {
    const soon: FridgeItem[] = [];
    const ok: FridgeItem[] = [];
    const nodate: FridgeItem[] = [];
    for (const it of items) {
      if (!it.expiries || it.expiries.length === 0) { nodate.push(it); continue; }
      const min = Math.min(...it.expiries.map(daysUntil).filter(Number.isFinite));
      if (min <= 3) soon.push(it);
      else ok.push(it);
    }
    const byEarliestExpiry = (a: FridgeItem, b: FridgeItem) => {
      const ea = a.expiries && a.expiries.length ? [...a.expiries].sort()[0] : '';
      const eb = b.expiries && b.expiries.length ? [...b.expiries].sort()[0] : '';
      return ea.localeCompare(eb);
    };
    soon.sort(byEarliestExpiry);
    ok.sort(byEarliestExpiry);
    // For no-date items, keep insertion order (by creation).
    return { soon, ok, nodate };
  }, [items]);

  if (!isPro) {
    return (
      <SafeAreaView style={styles.root} edges={['top']} testID="fridge-tab-locked">
        <View style={styles.header}>
          <Text style={styles.h1}>{t('fridge.title')}</Text>
        </View>
        <ScrollView
          contentContainerStyle={styles.lockScroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.lockCircle}>
            <Feather name="lock" size={38} color={theme.color.brand} />
          </View>
          <Text style={styles.lockTitle}>{t('fridge.lock.title')}</Text>
          <Text style={styles.lockBody}>{t('fridge.lock.body')}</Text>
          <Pressable onPress={() => setUpsell(true)} style={styles.lockCta} testID="fridge-unlock">
            <Feather name="star" size={16} color="#fff" />
            <Text style={styles.lockCtaTxt}>{t('pro.cta')}</Text>
          </Pressable>
        </ScrollView>
        <ProUpsellModal open={upsell} onClose={() => setUpsell(false)} feature="fridge" />
      </SafeAreaView>
    );
  }

  const renderItem = (it: FridgeItem) => {
    const cat = catById[it.category_id || 'altro'];
    const nextExp = it.expiries && it.expiries.length > 0
      ? [...it.expiries].sort()[0]
      : null;
    const d = nextExp ? daysUntil(nextExp) : Number.NaN;
    let badgeBg = '#E5EDDF', badgeFg = theme.color.brandSecondary, badgeLbl = '';
    if (nextExp) {
      const dt = parseIso(nextExp);
      const shortDate = dt ? dt.toLocaleDateString(locale, { day: '2-digit', month: 'short' }) : '';
      if (d < 0) { badgeBg = '#F5E0DC'; badgeFg = theme.color.error; badgeLbl = t('expiry.expired', { n: -d }); }
      else if (d === 0) { badgeBg = '#F5E0DC'; badgeFg = theme.color.error; badgeLbl = t('expiry.today'); }
      else if (d === 1) { badgeBg = '#FDE2CE'; badgeFg = theme.color.brand; badgeLbl = t('expiry.tomorrow'); }
      else if (d <= 3) { badgeBg = '#FDE2CE'; badgeFg = theme.color.brand; badgeLbl = t('expiry.in', { n: d }); }
      else { badgeBg = '#E5EDDF'; badgeFg = theme.color.brandSecondary; badgeLbl = shortDate; }
    }
    return (
      <Pressable
        onPress={() => router.push(`/fridge/${it.id}`)}
        style={styles.row}
        testID={`fridge-item-${it.id}`}
      >
        <PhotoThumb path={it.photo_path} size={44} rounded fallbackEmoji={cat?.icon || '📦'} fallbackIcon="package" />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.rowName}>{it.name}</Text>
          <Text style={styles.rowMeta}>
            {it.quantity ? `${it.quantity} ${it.unit}` : it.unit}
            {cat ? `  ·  ${cat.icon || '📦'} ${tCat(cat)}` : ''}
          </Text>
          {nextExp ? (
            <View style={[styles.badge, { backgroundColor: badgeBg }]}>
              <Feather name="clock" size={10} color={badgeFg} />
              <Text style={[styles.badgeTxt, { color: badgeFg }]}>{badgeLbl}</Text>
              {it.expiries.length > 1 && (
                <Text style={[styles.badgeTxt, { color: badgeFg, marginLeft: 4 }]}>+{it.expiries.length - 1}</Text>
              )}
            </View>
          ) : (
            <Text style={styles.rowNoDate}>{t('fridge.noDate')}</Text>
          )}
        </View>
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); del(it.id); }}
          style={styles.delBtn}
          hitSlop={12}
          testID={`fridge-delete-${it.id}`}
        >
          <Feather name="trash-2" size={16} color={theme.color.onSurfaceTertiary} />
        </Pressable>
      </Pressable>
    );
  };

  const groups: { key: string; label: string; data: FridgeItem[] }[] = [
    { key: 'soon', label: t('fridge.group.soon'), data: sections.soon },
    { key: 'ok', label: t('fridge.group.ok'), data: sections.ok },
    { key: 'nodate', label: t('fridge.group.nodate'), data: sections.nodate },
  ].filter(g => g.data.length > 0);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="fridge-tab">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>{t('fridge.title')}</Text>
          <Text style={styles.sub}>
            {items.length === 1 ? t('spesa.count.item') : t('spesa.count.items', { n: items.length })}
          </Text>
        </View>
        <Pressable
          onPress={onRefresh}
          style={styles.iconBtn}
          testID="fridge-refresh"
          disabled={refreshing}
        >
          {refreshing ? <ActivityIndicator size="small" color={theme.color.onSurface} /> : <Feather name="refresh-cw" size={17} color={theme.color.onSurface} />}
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brandPrimary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Feather name="package" size={44} color={theme.color.borderStrong} />
          <Text style={styles.emptyH}>{t('fridge.empty.title')}</Text>
          <Text style={styles.emptyP}>{t('fridge.empty.sub')}</Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={g => g.key}
          contentContainerStyle={{
            padding: theme.spacing.lg,
            paddingBottom: 100 + Math.max(insets.bottom, 0),
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brandPrimary} />}
          renderItem={({ item: group }) => (
            <View style={{ marginBottom: theme.spacing.md }}>
              <Text style={styles.groupLabel}>{group.label.toUpperCase()}</Text>
              {group.data.map(it => (
                <View key={it.id} style={{ marginTop: 8 }}>
                  {renderItem(it)}
                </View>
              ))}
            </View>
          )}
        />
      )}

      {/* Floating "New ingredient" button (visible only when Pro+) */}
      <Pressable
        onPress={() => router.push('/fridge/new')}
        style={[styles.fab, { bottom: 20 + Math.max(insets.bottom, 0) }]}
        testID="fridge-add"
      >
        <Feather name="plus" size={22} color="#fff" />
        <Text style={styles.fabTxt}>{t('fridge.newItem')}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.color.divider, backgroundColor: theme.color.surface, gap: 8,
  },
  h1: { fontFamily: theme.font.display, fontSize: 26, color: theme.color.onSurface },
  sub: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  emptyH: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface, marginTop: theme.spacing.md, textAlign: 'center' },
  emptyP: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 6, textAlign: 'center', maxWidth: 280 },
  groupLabel: { fontSize: 11, fontWeight: '700', color: theme.color.onSurfaceTertiary, letterSpacing: 0.6 },
  fab: {
    position: 'absolute', right: 20,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.brandPrimary,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 10, elevation: 6,
  },
  fabTxt: { color: '#fff', fontWeight: '600', fontSize: 14 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface,
  },
  rowName: { fontSize: 15, color: theme.color.onSurface, fontWeight: '600' },
  rowMeta: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  rowNoDate: { fontSize: 11, color: theme.color.onSurfaceTertiary, fontStyle: 'italic', marginTop: 4 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, alignSelf: 'flex-start', marginTop: 4 },
  badgeTxt: { fontSize: 11, fontWeight: '600' },
  delBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  // Locked state
  lockScroll: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center',
    padding: theme.spacing.xl, paddingBottom: theme.spacing.xxxl, gap: 16,
  },
  lockCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#F5E8D8', alignItems: 'center', justifyContent: 'center' },
  lockTitle: { fontFamily: theme.font.display, fontSize: 22, color: theme.color.onSurface, textAlign: 'center' },
  lockBody: { fontSize: 14, color: theme.color.onSurfaceSecondary, textAlign: 'center', maxWidth: 300 },
  lockCta: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.color.brand, paddingHorizontal: 24, paddingVertical: 12, borderRadius: theme.radius.pill },
  lockCtaTxt: { color: '#fff', fontWeight: '600' },
});
