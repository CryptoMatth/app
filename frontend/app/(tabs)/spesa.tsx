import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

type Item = {
  id: string; name: string; unit: string;
  manual_qty: number; planner_qty: number;
  sources: { dish_name: string; quantity: number }[];
  notes?: string;
  checked: boolean; order: number;
};

function totalQty(it: Item) { return (it.manual_qty || 0) + (it.planner_qty || 0); }
function formatQty(n: number) {
  if (n % 1 === 0) return String(n);
  return n.toFixed(1);
}

export default function Spesa() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    try { const list = await api.listShopping(); setItems(list); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

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

  const clearBought = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { await api.clearChecked(); await load(); } catch {}
  };

  const boughtCount = items.filter(i => i.checked).length;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="spesa-screen">
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>Spesa</Text>
            <Text style={styles.sub}>
              {items.length} elementi{boughtCount > 0 ? ` · ${boughtCount} già presi` : ''}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: theme.color.brandSecondary }]} />
                <Text style={styles.legendTxt}>Planner</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: theme.color.brand }]} />
                <Text style={styles.legendTxt}>Manuale</Text>
              </View>
            </View>
            <Pressable onPress={() => router.push('/settings')} style={styles.settingsBtn} testID="open-settings">
              <Feather name="settings" size={18} color={theme.color.onSurface} />
            </Pressable>
          </View>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brandPrimary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Feather name="shopping-cart" size={44} color={theme.color.borderStrong} />
          <Text style={styles.emptyH}>Lista vuota</Text>
          <Text style={styles.emptyP}>Aggiungi un ingrediente o piani­fica un pasto per iniziare.</Text>
        </View>
      ) : (
        <DraggableFlatList
          data={items}
          keyExtractor={(item) => item.id}
          onDragEnd={({ data }) => onReorder(data)}
          onDragBegin={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 160 }}
          renderItem={({ item, drag, isActive }: RenderItemParams<Item>) => (
            <ScaleDecorator>
              <View style={[styles.row, item.checked && { opacity: 0.55 }, isActive && styles.rowActive]} testID={`shop-item-${item.id}`}>
                <Pressable onPress={() => toggle(item.id, item.checked)} style={styles.check} testID={`check-${item.id}`}>
                  <View style={[styles.checkbox, item.checked && styles.checkboxOn]}>
                    {item.checked && <Feather name="check" size={14} color="#fff" />}
                  </View>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTitleWrap}>
                    {item.planner_qty > 0 && <View style={[styles.dot, { backgroundColor: theme.color.brandSecondary }]} />}
                    {item.manual_qty > 0 && <View style={[styles.dot, { backgroundColor: theme.color.brand }]} />}
                    <Text style={[styles.itemName, item.checked && styles.strike]}>{item.name}</Text>
                  </View>
                  <Text style={styles.itemQty}>
                    {formatQty(totalQty(item))} {item.unit}
                    {item.planner_qty > 0 && item.manual_qty > 0
                      ? `  ·  ${formatQty(item.planner_qty)}${item.unit} planner + ${formatQty(item.manual_qty)}${item.unit} manuale`
                      : item.planner_qty > 0
                        ? `  ·  ${item.sources.map(s => s.dish_name).slice(0, 2).join(', ')}`
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
          )}
          ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
        />
      )}

      <View style={styles.actions}>
        {boughtCount > 0 && (
          <Pressable onPress={clearBought} style={styles.secondary} testID="clear-checked">
            <Feather name="trash-2" size={16} color={theme.color.onSurface} />
            <Text style={styles.secondaryTxt}>Rimuovi presi</Text>
          </Pressable>
        )}
        <Pressable onPress={() => router.push('/shopping/new')} style={styles.primary} testID="show-add">
          <Feather name="plus" size={20} color="#fff" />
          <Text style={styles.primaryTxt}>Aggiungi</Text>
        </Pressable>
      </View>

      <Modal
        transparent
        visible={!!confirmDelete}
        animationType="fade"
        onRequestClose={() => setConfirmDelete(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="confirm-delete-modal">
            <View style={styles.modalIcon}>
              <Feather name="alert-triangle" size={24} color={theme.color.warning} />
            </View>
            <Text style={styles.modalH}>Eliminare {'"'}{confirmDelete?.name}{'"'}?</Text>
            <Text style={styles.modalP}>
              {confirmDelete?.planner_qty && confirmDelete.planner_qty > 0
                ? 'Questo ingrediente è stato aggiunto dal planner. Verrà rimosso completamente dalla lista della spesa, ma i piatti nel planner resteranno.'
                : 'L\'ingrediente verrà rimosso dalla lista della spesa.'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
              <Pressable
                onPress={() => setConfirmDelete(null)}
                style={styles.btnGhost}
                testID="confirm-cancel"
                disabled={deleting}
              >
                <Text style={styles.btnGhostTxt}>Annulla</Text>
              </Pressable>
              <Pressable
                onPress={doDelete}
                style={styles.btnDanger}
                testID="confirm-delete"
                disabled={deleting}
              >
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnDangerTxt}>Elimina</Text>}
              </Pressable>
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(44,40,38,0.55)', alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  modalCard: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, padding: theme.spacing.xl, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: theme.color.border },
  modalIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md },
  modalH: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface, marginBottom: 6 },
  modalP: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 18 },
});
