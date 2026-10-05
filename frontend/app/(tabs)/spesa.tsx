import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Modal, RefreshControl, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { TipBanner } from '@/src/TipBanner';
import { TutorialKeys } from '@/src/tutorial';
import { useTranslation } from '@/src/i18n';
import { PhotoThumb } from '@/src/PhotoPicker';
import { useIsPro, useHasTier } from '@/src/ProGate';

type Item = {
  id: string; name: string; unit: string;
  manual_qty: number; planner_qty: number;
  sources: { dish_name: string; quantity: number }[];
  notes?: string;
  category_id?: string;
  photo_path?: string | null;
  checked: boolean; order: number;
};

function totalQty(it: Item) { return (it.manual_qty || 0) + (it.planner_qty || 0); }
function formatQty(n: number) {
  if (n % 1 === 0) return String(n);
  return n.toFixed(1);
}
/** Return the list of unique dish names in this item's sources, first 2. */
function uniqueDishNames(item: Item): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of item.sources || []) {
    const n = (s.dish_name || '').trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= 2) break;
  }
  return out;
}

export default function Spesa() {
  const { t, tCat } = useTranslation();
  const { prefs } = useAuth();
  const isPro = useIsPro();
  const isProPlus = useHasTier('pro_plus');
  const insets = useSafeAreaInsets();
  const cats = prefs.ingredient_categories;
  const catById = useMemo(() => {
    const m: Record<string, typeof cats[number]> = {};
    for (const c of cats) m[c.id] = c;
    return m;
  }, [cats]);
  const catOrderIdx = useMemo(() => {
    const m: Record<string, number> = {};
    cats.forEach((c, i) => (m[c.id] = i));
    return m;
  }, [cats]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Item | null>(null);
  const [confirmClearBought, setConfirmClearBought] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const router = useRouter();

  // Sort items so they're grouped by category (following prefs order),
  // then by their own server-side `order` inside a category.
  const groupedItems = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      // Checked items go to the bottom regardless of category
      if (a.checked !== b.checked) return a.checked ? 1 : -1;
      // Non Pro+ users have no category grouping — sort by `order` only.
      if (!isProPlus) return (a.order || 0) - (b.order || 0);
      const ac = a.category_id || 'altro';
      const bc = b.category_id || 'altro';
      const ai = catOrderIdx[ac] ?? 999;
      const bi = catOrderIdx[bc] ?? 999;
      if (ai !== bi) return ai - bi;
      return (a.order || 0) - (b.order || 0);
    });
    return arr;
  }, [items, catOrderIdx, isProPlus]);

  // Build a Set of the first item id in each category so we know where
  // to render the sticky-ish category header inside renderItem.
  const firstOfCategory = useMemo(() => {
    // Non Pro+ users don't see category headers at all.
    if (!isProPlus) return new Set<string>();
    const first: Record<string, string> = {}; // catId -> first item.id (unchecked)
    for (const it of groupedItems) {
      if (it.checked) continue;
      const c = it.category_id || 'altro';
      if (!first[c]) first[c] = it.id;
    }
    return new Set(Object.values(first));
  }, [groupedItems, isProPlus]);
  const firstCheckedId = useMemo(() => {
    return groupedItems.find(i => i.checked)?.id;
  }, [groupedItems]);

  const load = useCallback(async () => {
    try { const list = await api.listShopping(); setItems(list); } catch {}
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const toggle = async (id: string, checked: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Optimistic: when checking, move to end; when unchecking, keep in place
    setItems(prev => {
      const found = prev.find(i => i.id === id);
      if (!found) return prev;
      const rest = prev.filter(i => i.id !== id);
      const updated = { ...found, checked: !checked };
      if (!checked) {
        // was unchecked → check → to end
        return [...rest, updated];
      }
      return prev.map(i => i.id === id ? updated : i);
    });
    try { await api.toggleShopping(id, !checked); await load(); } catch { load(); }
  };

  const askDelete = (item: Item) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setConfirmDelete(item);
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.forceDeleteShopping(confirmDelete.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setConfirmDelete(null);
      await load();
    } catch {
      load();
    }
    setDeleting(false);
  };

  const onReorder = async (newList: Item[]) => {
    setItems(newList);
    try { await api.reorderShopping(newList.map(i => i.id)); } catch {}
  };

  const clearBought = async (toFridge: boolean) => {
    setClearing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { await api.clearChecked(toFridge); await load(); } catch {}
    setClearing(false);
    setConfirmClearBought(false);
  };

  const boughtCount = items.filter(i => i.checked).length;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="spesa-screen">
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>{t('spesa.title')}</Text>
            <Text style={styles.sub}>
              {items.length === 1 ? t('spesa.count.item') : t('spesa.count.items', { n: items.length })}
              {boughtCount > 0 ? ` · ${t('spesa.count.bought', { n: boughtCount })}` : ''}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: theme.color.brand }]} />
                <Text style={styles.legendTxt}>{t('spesa.legend.planner')}</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: theme.color.warning }]} />
                <Text style={styles.legendTxt}>{t('spesa.legend.manual')}</Text>
              </View>
            </View>
            <Pressable
              onPress={onRefresh}
              style={styles.settingsBtn}
              testID="spesa-refresh"
              disabled={refreshing}
              accessibilityLabel={t('common.refresh')}
            >
              {refreshing ? (
                <ActivityIndicator size="small" color={theme.color.onSurface} />
              ) : (
                <Feather name="refresh-cw" size={17} color={theme.color.onSurface} />
              )}
            </Pressable>
            <Pressable onPress={() => router.push('/settings')} style={styles.settingsBtn} testID="open-settings">
              <Feather name="settings" size={18} color={theme.color.onSurface} />
            </Pressable>
          </View>
        </View>
      </View>

      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md }}>
        <TipBanner
          storageKey={TutorialKeys.tipSpesa}
          icon="shopping-cart"
          title={t('spesa.tip.title')}
          body={t('spesa.tip.body')}
          testID="tip-spesa"
        />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brandPrimary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Feather name="shopping-cart" size={44} color={theme.color.borderStrong} />
          <Text style={styles.emptyH}>{t('spesa.empty.title')}</Text>
          <Text style={styles.emptyP}>{t('spesa.empty.sub')}</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <DraggableFlatList
            data={groupedItems}
            keyExtractor={(item) => item.id}
            onDragEnd={({ data }) => onReorder(data)}
            onDragBegin={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)}
            activationDistance={12}
            containerStyle={{ flex: 1 }}
            contentContainerStyle={{
              padding: theme.spacing.lg,
              paddingBottom: 180 + Math.max(insets.bottom, 0),
            }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.brandPrimary} />
            }
          renderItem={({ item, drag, isActive }: RenderItemParams<Item>) => {
            const showHeader = !item.checked && firstOfCategory.has(item.id);
            const catId = item.category_id || 'altro';
            const cat = catById[catId];
            const showBoughtHeader = item.checked && item.id === firstCheckedId;
            return (
              <ScaleDecorator>
                {showHeader && (
                  <View style={styles.catHeader} testID={`cat-header-${catId}`}>
                    <Text style={styles.catEmoji}>{cat?.icon || '📦'}</Text>
                    <Text style={styles.catLabel}>{tCat(cat) || t('spesa.uncategorized')}</Text>
                  </View>
                )}
                {showBoughtHeader && (
                  <View style={[styles.catHeader, { marginTop: theme.spacing.md }]} testID="cat-header-bought">
                    <Feather name="check-circle" size={14} color={theme.color.onSurfaceTertiary} />
                    <Text style={[styles.catLabel, { color: theme.color.onSurfaceTertiary }]}>{t('spesa.bought')}</Text>
                  </View>
                )}
                <View style={[styles.row, item.checked && { opacity: 0.55 }, isActive && styles.rowActive]} testID={`shop-item-${item.id}`}>
                  <Pressable onPress={() => toggle(item.id, item.checked)} style={styles.check} testID={`check-${item.id}`}>
                    <View style={[styles.checkbox, item.checked && styles.checkboxOn]}>
                      {item.checked && <Feather name="check" size={14} color="#fff" />}
                    </View>
                  </Pressable>
                  <PhotoThumb path={item.photo_path} size={36} rounded fallbackEmoji={catById[item.category_id || 'altro']?.icon || '🛒'} fallbackIcon="shopping-bag" />
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <View style={styles.rowTitleWrap}>
                      {item.planner_qty > 0 && <View style={[styles.dot, { backgroundColor: theme.color.brand }]} />}
                      {item.manual_qty > 0 && <View style={[styles.dot, { backgroundColor: theme.color.warning }]} />}
                      <Text style={[styles.itemName, item.checked && styles.strike]}>{item.name}</Text>
                    </View>
                    <Text style={styles.itemQty}>
                      {formatQty(totalQty(item))} {item.unit}
                      {item.planner_qty > 0 && item.manual_qty > 0
                        ? `  ·  ${t('spesa.mix.plannerAndManual', { p: formatQty(item.planner_qty), m: formatQty(item.manual_qty), unit: item.unit })}`
                        : item.planner_qty > 0
                          ? `  ·  ${uniqueDishNames(item).join(', ')}`
                          : ''}
                    </Text>
                    {item.notes ? (
                      <View style={styles.notesRow}>
                        <Feather name="edit-2" size={11} color={theme.color.onSurfaceTertiary} />
                        <Text style={styles.notesTxt} numberOfLines={2}>{item.notes}</Text>
                      </View>
                  ) : null}
                </View>
                <Pressable onPress={() => router.push(`/shopping/${item.id}`)} style={styles.iconBtn} testID={`edit-${item.id}`}>
                  <Feather name="edit-3" size={18} color={theme.color.onSurfaceTertiary} />
                </Pressable>
                <Pressable onPress={() => askDelete(item)} style={styles.iconBtn} testID={`del-${item.id}`}>
                  <Feather name="x" size={18} color={theme.color.onSurfaceTertiary} />
                </Pressable>
                <Pressable onLongPress={drag} delayLongPress={150} style={styles.iconBtn} testID={`drag-${item.id}`}>
                  <Feather name="menu" size={18} color={theme.color.onSurfaceTertiary} />
                </Pressable>
              </View>
            </ScaleDecorator>
            );
          }}
          ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
          />
        </View>
      )}

      <View style={styles.actions}>
        {boughtCount > 0 && (
          <Pressable onPress={() => { Haptics.selectionAsync(); setConfirmClearBought(true); }} style={styles.secondary} testID="clear-checked">
            <Feather name="trash-2" size={16} color={theme.color.onSurface} />
            <Text style={styles.secondaryTxt}>{t('spesa.clearBought')}</Text>
          </Pressable>
        )}
        <Pressable onPress={() => router.push('/shopping/new')} style={styles.primary} testID="show-add">
          <Feather name="plus" size={20} color="#fff" />
          <Text style={styles.primaryTxt}>{t('common.add')}</Text>
        </Pressable>
      </View>

      <Modal
        transparent
        visible={confirmClearBought}
        animationType="fade"
        onRequestClose={() => setConfirmClearBought(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '85%' }]} testID="confirm-clear-bought-modal">
            <ScrollView
              contentContainerStyle={{ padding: theme.spacing.xl }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.modalIcon}>
                <Feather name="trash-2" size={24} color={theme.color.warning} />
              </View>
              <Text style={styles.modalH}>{t('spesa.clearConfirm.title', { n: boughtCount })}</Text>
              <Text style={styles.modalP}>
                {isProPlus ? t('spesa.clearConfirm.bodyChoice') : t('spesa.clearConfirm.body')}
              </Text>
              <View style={{ gap: 8, marginTop: theme.spacing.md }}>
                {isProPlus && (
                  <Pressable
                    onPress={() => clearBought(true)}
                    style={styles.btnPrim}
                    testID="confirm-clear-to-fridge"
                    disabled={clearing}
                  >
                    {clearing ? <ActivityIndicator color="#fff" /> : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Feather name="package" size={16} color="#fff" />
                        <Text style={styles.btnDangerTxt}>{t('spesa.clearConfirm.toFridge')}</Text>
                      </View>
                    )}
                  </Pressable>
                )}
                <Pressable
                  onPress={() => clearBought(false)}
                  style={styles.btnDanger}
                  testID="confirm-clear-delete"
                  disabled={clearing}
                >
                  {clearing ? <ActivityIndicator color="#fff" /> : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Feather name="trash-2" size={16} color="#fff" />
                      <Text style={styles.btnDangerTxt}>
                        {isProPlus ? t('spesa.clearConfirm.deleteOnly') : t('common.remove')}
                      </Text>
                    </View>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => setConfirmClearBought(false)}
                  style={styles.btnGhost}
                  testID="confirm-clear-cancel"
                  disabled={clearing}
                >
                  <Text style={styles.btnGhostTxt}>{t('common.cancel')}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={!!confirmDelete}
        animationType="fade"
        onRequestClose={() => setConfirmDelete(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="confirm-delete-modal">
            <View style={{ padding: theme.spacing.xl }}>
              <View style={styles.modalIcon}>
                <Feather name="alert-triangle" size={24} color={theme.color.warning} />
              </View>
              <Text style={styles.modalH}>{t('spesa.deleteConfirm.title', { name: confirmDelete?.name || '' })}</Text>
              <Text style={styles.modalP}>
                {confirmDelete?.planner_qty && confirmDelete.planner_qty > 0
                  ? t('spesa.deleteConfirm.bodyPlanner')
                  : t('spesa.deleteConfirm.body')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
                <Pressable
                  onPress={() => setConfirmDelete(null)}
                  style={styles.btnGhost}
                  testID="confirm-cancel"
                  disabled={deleting}
                >
                  <Text style={styles.btnGhostTxt}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  onPress={doDelete}
                  style={styles.btnDanger}
                  testID="confirm-delete"
                  disabled={deleting}
                >
                  {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnDangerTxt}>{t('common.delete')}</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settingsBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border },
  h1: { fontFamily: theme.font.display, fontSize: 30, color: theme.color.onSurface },
  sub: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  legend: { gap: 4, alignItems: 'flex-end' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendTxt: { fontSize: 11, color: theme.color.onSurfaceTertiary },
  catHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: theme.spacing.sm, paddingVertical: 6,
    marginTop: theme.spacing.md, marginBottom: 4,
  },
  catEmoji: { fontSize: 15 },
  catLabel: {
    fontSize: 12, fontWeight: '700', color: theme.color.onSurfaceSecondary,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl, gap: 8 },
  emptyH: { fontFamily: theme.font.display, fontSize: 20, color: theme.color.onSurface, marginTop: 8 },
  emptyP: { fontSize: 13, color: theme.color.onSurfaceSecondary, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: theme.spacing.md,
    borderWidth: 1, borderColor: theme.color.border,
  },
  rowActive: { borderColor: theme.color.brandPrimary, backgroundColor: theme.color.surfaceSecondary },
  rowTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  check: { paddingRight: theme.spacing.sm },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 1.5,
    borderColor: theme.color.borderStrong, alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: theme.color.brandSecondary, borderColor: theme.color.brandSecondary },
  itemName: { fontSize: 15, color: theme.color.onSurface, fontWeight: '500' },
  strike: { textDecorationLine: 'line-through' },
  itemQty: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  notesRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  notesTxt: { flex: 1, fontSize: 11, color: theme.color.onSurfaceTertiary, fontStyle: 'italic' },
  iconBtn: { padding: 6 },
  actions: { position: 'absolute', left: theme.spacing.lg, right: theme.spacing.lg, bottom: theme.spacing.lg, flexDirection: 'row', gap: 10 },
  primary: { flex: 1, backgroundColor: theme.color.brandPrimary, borderRadius: theme.radius.pill, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryTxt: { color: '#fff', fontWeight: '600', fontSize: 15 },
  secondary: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: theme.color.border },
  secondaryTxt: { color: theme.color.onSurface, fontWeight: '500', fontSize: 14 },
  btnGhost: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  btnGhostTxt: { color: theme.color.onSurface, fontWeight: '500' },
  btnDanger: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.error, alignItems: 'center', justifyContent: 'center' },
  btnDangerTxt: { color: '#fff', fontWeight: '600' },
  btnPrim: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(44,40,38,0.55)', alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  modalCard: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: theme.color.border, overflow: 'hidden' },
  modalIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md },
  modalH: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface, marginBottom: 6 },
  modalP: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 18 },
});
