import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { useTranslation } from '@/src/i18n';
import { IngredientEditorForm, type IngredientDraft } from '@/src/IngredientEditorForm';

type Props = { id?: string };

export default function ShoppingEditor({ id }: Props) {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const itemId = id || (params.id as string | undefined);
  const isNew = !itemId || itemId === 'new';
  const { t } = useTranslation();

  const [draft, setDraft] = useState<IngredientDraft>({ name: '', quantity: '', unit: 'g', category_id: 'altro', notes: '', photo_path: null });
  const [plannerQty, setPlannerQty] = useState(0);
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const list = await api.listShopping();
        const it = list.find((x: any) => x.id === itemId);
        if (it) {
          setDraft({
            name: it.name || '',
            quantity: String(it.manual_qty || 0),
            unit: it.unit || 'g',
            notes: it.notes || '',
            category_id: it.category_id || 'altro',
            photo_path: it.photo_path || null,
          });
          setPlannerQty(it.planner_qty || 0);
        }
      } catch {}
      setLoading(false);
    })();
  }, [itemId, isNew]);

  const save = async () => {
    Keyboard.dismiss();
    setErr('');
    if (!draft.name.trim()) { setErr(t('spesa.errors.name')); return; }
    const q = parseFloat((draft.quantity || '0').replace(',', '.'));
    if (!isNew && draft.quantity === '') {
      // OK — keep existing
    } else if (isNaN(q) || q < 0) {
      setErr(t('spesa.errors.qty')); return;
    }
    setBusy(true);
    try {
      if (isNew) {
        if (q <= 0) { setErr(t('spesa.errors.qtyZero')); setBusy(false); return; }
        await api.addManual(draft.name.trim(), q, draft.unit, draft.notes || '', draft.category_id, draft.photo_path || null);
      } else {
        await api.editShopping(itemId!, {
          name: draft.name.trim(),
          quantity: q,
          unit: draft.unit,
          notes: draft.notes || '',
          category_id: draft.category_id,
          photo_path: draft.photo_path || null,
        });
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.back();
    } catch (e: any) {
      setErr(e.message || t('spesa.errors.save'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <View style={styles.centerLoad}><ActivityIndicator color={theme.color.brandPrimary} /></View>;
  }

  const quantitySuffix = plannerQty > 0 ? t('spesa.qtyPlanner', { n: plannerQty, unit: draft.unit }) : '';

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="shopping-editor">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.hBtn} testID="shopping-back">
          <Feather name="x" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.hTitle}>{isNew ? t('spesa.newIngredient') : t('spesa.editIngredient')}</Text>
        <View style={styles.hBtn} />
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 160 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={80}
      >
        <IngredientEditorForm
          value={draft}
          onChange={setDraft}
          quantitySuffix={quantitySuffix}
          testIDPrefix="shop"
        />
        {err ? <Text style={styles.err} testID="shop-error">{err}</Text> : null}
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={styles.saveWrap}>
          <Pressable onPress={save} disabled={busy} style={styles.saveBtn} testID="shop-save">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>{isNew ? t('spesa.add') : t('spesa.saveChanges')}</Text>}
          </Pressable>
        </View>
      </KeyboardStickyView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  centerLoad: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  hBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hTitle: { flex: 1, textAlign: 'center', fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface },
  err: { color: theme.color.error, fontSize: 13, marginTop: theme.spacing.md },
  saveWrap: { padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.color.divider, backgroundColor: theme.color.surface },
  saveBtn: { height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
