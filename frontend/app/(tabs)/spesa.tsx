import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

type Item = {
  id: string; name: string; unit: string;
  manual_qty: number; planner_qty: number;
  sources: { dish_name: string; quantity: number }[];
  checked: boolean; order: number;
};

const UNITS = ['g', 'kg', 'ml', 'l', 'pz'];

function totalQty(it: Item) { return (it.manual_qty || 0) + (it.planner_qty || 0); }
function formatQty(n: number) {
  if (n >= 1000 && n % 1 === 0) return String(n);
  if (n % 1 === 0) return String(n);
  return n.toFixed(1);
}

export default function Spesa() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('g');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const list = await api.listShopping(); setItems(list); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (id: string, checked: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setItems(prev => prev.map(i => i.id === id ? { ...i, checked: !checked } : i));
    try { await api.toggleShopping(id, !checked); } catch { load(); }
  };

  const remove = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setItems(prev => prev.filter(i => i.id !== id));
    try { await api.deleteShopping(id); load(); } catch { load(); }
  };

  const onReorder = async (newList: Item[]) => {
    setItems(newList);
    try { await api.reorderShopping(newList.map(i => i.id)); } catch {}
  };

  const submitAdd = async () => {
    Keyboard.dismiss();
    if (!name.trim() || !qty) return;
    const q = parseFloat(qty.replace(',', '.'));
    if (isNaN(q) || q <= 0) return;
    setBusy(true);
    try {
      await api.addManual(name.trim(), q, unit);
      setName(''); setQty(''); setShowAdd(false);
      await load();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}
    setBusy(false);
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
          <View>
            <Text style={styles.h1}>Spesa</Text>
            <Text style={styles.sub}>
              {items.length} elementi{boughtCount > 0 ? ` · ${boughtCount} già presi` : ''}
            </Text>
          </View>
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
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brandPrimary} /></View>
      ) : items.length === 0 && !showAdd ? (
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
                </View>
                {item.manual_qty > 0 && (
                  <Pressable onPress={() => remove(item.id)} style={styles.iconBtn} testID={`del-${item.id}`}>
                    <Feather name="x" size={16} color={theme.color.onSurfaceTertiary} />
                  </Pressable>
                )}
                <Pressable onLongPress={drag} delayLongPress={150} style={styles.iconBtn} testID={`drag-${item.id}`}>
                  <Feather name="menu" size={18} color={theme.color.onSurfaceTertiary} />
                </Pressable>
              </View>
            </ScaleDecorator>
          )}
          ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
        />
      )}

      {showAdd && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.addWrap}>
          <View style={styles.addCard}>
            <Text style={styles.addH}>Aggiungi ingrediente</Text>
            <TextInput
              testID="add-name-input"
              placeholder="Nome (es. pomodoro)"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              value={name} onChangeText={setName}
              style={styles.input}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextInput
                testID="add-qty-input"
                placeholder="Quantità"
                placeholderTextColor={theme.color.onSurfaceTertiary}
                value={qty} onChangeText={setQty}
                keyboardType="numeric"
                style={[styles.input, { flex: 1 }]}
              />
              <View style={styles.unitPicker}>
                {UNITS.map(u => (
                  <Pressable
                    key={u}
                    testID={`unit-${u}`}
                    onPress={() => setUnit(u)}
                    style={[styles.unitBtn, unit === u && styles.unitBtnOn]}
                  >
                    <Text style={[styles.unitTxt, unit === u && styles.unitTxtOn]}>{u}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <Pressable onPress={() => setShowAdd(false)} style={[styles.btnGhost]} testID="cancel-add">
                <Text style={styles.btnGhostTxt}>Annulla</Text>
              </Pressable>
              <Pressable onPress={submitAdd} disabled={busy} style={[styles.btnPrim]} testID="submit-add">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimTxt}>Aggiungi</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {!showAdd && (
        <View style={styles.actions}>
          {boughtCount > 0 && (
            <Pressable onPress={clearBought} style={styles.secondary} testID="clear-checked">
              <Feather name="trash-2" size={16} color={theme.color.onSurface} />
              <Text style={styles.secondaryTxt}>Rimuovi presi</Text>
            </Pressable>
          )}
          <Pressable onPress={() => setShowAdd(true)} style={styles.primary} testID="show-add">
            <Feather name="plus" size={20} color="#fff" />
            <Text style={styles.primaryTxt}>Aggiungi</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, paddingBottom: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
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
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: theme.spacing.md,
    borderWidth: 1, borderColor: theme.color.border,
  },
  rowActive: { borderColor: theme.color.brandPrimary, backgroundColor: theme.color.surfaceSecondary },
  rowTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  check: {},
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 1.5,
    borderColor: theme.color.borderStrong, alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: theme.color.brandSecondary, borderColor: theme.color.brandSecondary },
  itemName: { fontSize: 15, color: theme.color.onSurface, fontWeight: '500' },
  strike: { textDecorationLine: 'line-through' },
  itemQty: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  iconBtn: { padding: 6 },
  actions: { position: 'absolute', left: theme.spacing.lg, right: theme.spacing.lg, bottom: theme.spacing.lg, flexDirection: 'row', gap: 10 },
  primary: { flex: 1, backgroundColor: theme.color.brandPrimary, borderRadius: theme.radius.pill, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryTxt: { color: '#fff', fontWeight: '600', fontSize: 15 },
  secondary: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: theme.color.border },
  secondaryTxt: { color: theme.color.onSurface, fontWeight: '500', fontSize: 14 },
  addWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  addCard: {
    backgroundColor: theme.color.surface, borderTopLeftRadius: theme.radius.lg, borderTopRightRadius: theme.radius.lg,
    padding: theme.spacing.lg, borderWidth: 1, borderColor: theme.color.border, gap: 10,
  },
  addH: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface, marginBottom: 4 },
  input: {
    height: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    paddingHorizontal: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary,
    color: theme.color.onSurface, fontSize: 15,
  },
  unitPicker: { flexDirection: 'row', gap: 4, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: 3 },
  unitBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radius.sm, minWidth: 32, alignItems: 'center' },
  unitBtnOn: { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  unitTxt: { fontSize: 12, color: theme.color.onSurfaceSecondary },
  unitTxtOn: { color: theme.color.brandPrimary, fontWeight: '600' },
  btnGhost: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  btnGhostTxt: { color: theme.color.onSurface, fontWeight: '500' },
  btnPrim: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  btnPrimTxt: { color: '#fff', fontWeight: '600' },
});
