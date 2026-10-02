import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList, RefreshControl, ScrollView, TextInput,
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
import { ConfirmSheet } from '@/src/ConfirmSheet';
import type { ExpiryEntry } from '@/src/auth';

type FridgeItem = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  category_id?: string;
  photo_path?: string | null;
  notes?: string;
  expiries: ExpiryEntry[]; // {date, label?}
  created_at?: string;
};

// Turn any incoming expiry (legacy string or new dict) into just its ISO date.
function expDate(e: any): string {
  if (!e) return '';
  return typeof e === 'string' ? e : (e.date || '');
}

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
  const [query, setQuery] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  // Confirmation sheet state for delete action — replaces the OS Alert.alert.
  const [confirmDel, setConfirmDel] = useState<{ id: string; name: string } | null>(null);
  const loadUnread = useCallback(async () => {
    try {
      const r = await api.listNotifications();
      setUnreadCount(r?.unread || 0);
    } catch {}
  }, []);
  useFocusEffect(useCallback(() => { loadUnread(); }, [loadUnread]));

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

  const del = (id: string, name?: string) => {
    setConfirmDel({ id, name: name || '' });
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    try {
      await api.deleteFridge(confirmDel.id);
      setItems(prev => prev.filter(x => x.id !== confirmDel.id));
    } catch {}
  };

  // Group items by status: expired (impossible thanks to auto-cleanup but keep guard), expiring soon, ok, no-date.
  // Within each section, sort ascending by earliest expiry so items closer to expiring
  // appear first.
  // Filter items by the search query (case/accent-insensitive, matches name or notes).
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(it => {
      const hay = `${it.name || ''} ${it.notes || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  const sections = useMemo(() => {
    const expired: FridgeItem[] = [];
    const soon: FridgeItem[] = [];
    const ok: FridgeItem[] = [];
    const nodate: FridgeItem[] = [];
    for (const it of filteredItems) {
      if (!it.expiries || it.expiries.length === 0) { nodate.push(it); continue; }
      const offsets = it.expiries.map(e => daysUntil(expDate(e))).filter(Number.isFinite);
      if (offsets.length === 0) { nodate.push(it); continue; }
      const min = Math.min(...offsets);
      // M7: expired bucket = EVERY date in the past. We also treat an item
      // as "expired" when all of its expiry dates have passed — the min
      // offset is the most-recent still-valid one, so if max < 0 everything
      // is expired.
      const max = Math.max(...offsets);
      if (max < 0) expired.push(it);
      else if (min <= 3) soon.push(it);
      else ok.push(it);
    }
    const byEarliestExpiry = (a: FridgeItem, b: FridgeItem) => {
      const ea = a.expiries && a.expiries.length ? [...a.expiries.map(expDate)].sort()[0] : '';
      const eb = b.expiries && b.expiries.length ? [...b.expiries.map(expDate)].sort()[0] : '';
      return ea.localeCompare(eb);
    };
    expired.sort(byEarliestExpiry);
    soon.sort(byEarliestExpiry);
    ok.sort(byEarliestExpiry);
    // For no-date items, keep insertion order (by creation).
    return { expired, soon, ok, nodate };
  }, [filteredItems]);

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
    const sortedExpiries = [...(it.expiries || [])].map(e => ({ date: expDate(e), label: typeof e === 'string' ? '' : (e.label || '') })).filter(x => x.date).sort((a, b) => a.date.localeCompare(b.date));
    const first = sortedExpiries[0];
    const nextExp = first ? first.date : null;
    const d = nextExp ? daysUntil(nextExp) : Number.NaN;
    let badgeBg = '#E5EDDF', badgeFg = theme.color.brandSecondary, badgeLbl = '';
    if (nextExp) {
      const dt = parseIso(nextExp);
      const now = new Date();
      const sameYear = dt ? dt.getFullYear() === now.getFullYear() : true;
      const shortDate = dt
        ? dt.toLocaleDateString(locale, sameYear
            ? { day: '2-digit', month: 'short' }
            : { day: '2-digit', month: 'short', year: 'numeric' })
        : '';
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
              <Text style={[styles.badgeTxt, { color: badgeFg }]}>{badgeLbl}{first?.label ? ` · ${first.label}` : ''}</Text>
              {sortedExpiries.length > 1 && (
                <Text style={[styles.badgeTxt, { color: badgeFg, marginLeft: 4 }]}>+{sortedExpiries.length - 1}</Text>
              )}
            </View>
          ) : (
            <Text style={styles.rowNoDate}>{t('fridge.noDate')}</Text>
          )}
        </View>
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); del(it.id, it.name); }}
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
    { key: 'expired', label: t('fridge.group.expired'), data: sections.expired },
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
          onPress={() => router.push('/notifications')}
          style={styles.iconBtn}
          testID="fridge-notifications"
          hitSlop={8}
        >
          <Feather name="bell" size={19} color={theme.color.onSurface} />
          {unreadCount > 0 && (
            <View style={styles.badgeBell} testID="notif-badge">
              <Text style={styles.badgeBellTxt}>{unreadCount > 9 ? '9+' : String(unreadCount)}</Text>
            </View>
          )}
        </Pressable>
        <Pressable
          onPress={onRefresh}
          style={styles.iconBtn}
          testID="fridge-refresh"
          disabled={refreshing}
        >
          {refreshing ? <ActivityIndicator size="small" color={theme.color.onSurface} /> : <Feather name="refresh-cw" size={17} color={theme.color.onSurface} />}
        </Pressable>
      </View>

      {/* Search bar — visible only when there are items. */}
      {!loading && items.length > 0 && (
        <View style={styles.searchWrap}>
          <Feather name="search" size={16} color={theme.color.onSurfaceTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('fridge.search.ph')}
            placeholderTextColor={theme.color.onSurfaceTertiary}
            style={styles.searchInput}
            testID="fridge-search"
            returnKeyType="search"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} testID="fridge-search-clear">
              <Feather name="x-circle" size={16} color={theme.color.onSurfaceTertiary} />
            </Pressable>
          )}
        </View>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brandPrimary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Feather name="package" size={44} color={theme.color.borderStrong} />
          <Text style={styles.emptyH}>{t('fridge.empty.title')}</Text>
          <Text style={styles.emptyP}>{t('fridge.empty.sub')}</Text>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.center}>
          <Feather name="search" size={44} color={theme.color.borderStrong} />
          <Text style={styles.emptyH}>{t('fridge.search.noResults')}</Text>
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
              <Text style={[
                styles.groupLabel,
                group.key === 'expired' && { color: theme.color.error },
              ]}>{group.label.toUpperCase()}</Text>
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

      {/* Styled delete confirmation (replaces the OS Alert) */}
      <ConfirmSheet
        visible={!!confirmDel}
        title={t('fridge.delete.title')}
        body={t('fridge.delete.body', { name: confirmDel?.name || '' })}
        icon="trash-2"
        tone="danger"
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={doDelete}
        onClose={() => setConfirmDel(null)}
        testID="fridge-delete-sheet"
      />
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
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: theme.spacing.lg,
    marginTop: 0, marginBottom: theme.spacing.sm,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  searchInput: {
    flex: 1, paddingVertical: 4, fontSize: 14,
    color: theme.color.onSurface,
  },
  sub: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  badgeBell: {
    position: 'absolute', top: 4, right: 4,
    minWidth: 16, height: 16, borderRadius: 8,
    paddingHorizontal: 4, backgroundColor: theme.color.error,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: theme.color.surfaceSecondary,
  },
  badgeBellTxt: { color: '#fff', fontSize: 9, fontWeight: '700' },
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
