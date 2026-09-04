/**
 * Shared ingredient / shopping-item / fridge-item editor form.
 *
 * Consumed as full-screen page by ShoppingEditor + FridgeEditor,
 * and as a modal from DishEditor (when adding/editing a dish ingredient).
 *
 * The parent owns state and passes callbacks — this component is pure UI.
 */
import { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, ScrollView, Modal,
} from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import * as Haptics from 'expo-haptics';
import { theme } from './theme';
import { useAuth } from './auth';
import { useTranslation } from './i18n';
import { PhotoPicker } from './PhotoPicker';

export const UNITS = ['g', 'kg', 'ml', 'l', 'pz', 'cucchiaio', 'cucchiaino', 'tazza', 'q.b.'];

export type IngredientDraft = {
  name: string;
  quantity: string; // string to allow "" during editing
  unit: string;
  notes?: string;
  category_id?: string;
  photo_path?: string | null;
};

type Props = {
  value: IngredientDraft;
  onChange: (v: IngredientDraft) => void;
  showNotes?: boolean;
  showCategory?: boolean;
  showPhoto?: boolean;
  quantitySuffix?: string;
  quantityLabel?: string;
  testIDPrefix?: string;
};

export function IngredientEditorForm({
  value, onChange,
  showNotes = true,
  showCategory = true,
  showPhoto = true,
  quantitySuffix,
  quantityLabel,
  testIDPrefix = 'ing',
}: Props) {
  const { prefs } = useAuth();
  const { t, tCat } = useTranslation();
  const cats = prefs.ingredient_categories;
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const patch = (p: Partial<IngredientDraft>) => onChange({ ...value, ...p });

  return (
    <View>
      {showPhoto && (
        <View style={{ alignItems: 'center', marginBottom: theme.spacing.sm }}>
          <PhotoPicker value={value.photo_path || null} onChange={(p) => patch({ photo_path: p })} size={92} testID={`${testIDPrefix}-photo`} />
        </View>
      )}

      <Text style={styles.label}>{t('common.name')}</Text>
      <TextInput
        testID={`${testIDPrefix}-name`}
        placeholder={t('piatti.ingredientNamePlaceholder')}
        placeholderTextColor={theme.color.onSurfaceTertiary}
        value={value.name}
        onChangeText={(text) => patch({ name: text })}
        style={styles.input}
        autoFocus={!value.name}
      />

      <Text style={styles.label}>{quantityLabel || t('spesa.qty') + (quantitySuffix ? ` ${quantitySuffix}` : '')}</Text>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'stretch' }}>
        <TextInput
          testID={`${testIDPrefix}-qty`}
          placeholder={t('spesa.qty')}
          placeholderTextColor={theme.color.onSurfaceTertiary}
          value={value.quantity}
          onChangeText={(text) => patch({ quantity: text })}
          keyboardType="numeric"
          style={[styles.input, styles.qtyInput]}
        />
        <Pressable
          testID={`${testIDPrefix}-unit-picker`}
          onPress={() => { Haptics.selectionAsync(); setUnitPickerOpen(true); }}
          style={styles.unitPickBtn}
        >
          <Text style={styles.unitPickTxt}>{value.unit}</Text>
          <Feather name="chevron-down" size={16} color={theme.color.onSurfaceSecondary} />
        </Pressable>
      </View>

      <Modal
        transparent
        visible={unitPickerOpen}
        animationType="fade"
        onRequestClose={() => setUnitPickerOpen(false)}
      >
        <Pressable style={styles.unitOverlay} onPress={() => setUnitPickerOpen(false)}>
          <Pressable style={styles.unitSheet} onPress={e => e.stopPropagation?.()}>
            <View style={styles.unitSheetHandle} />
            <Text style={styles.unitSheetTitle}>{t('common.unit')}</Text>
            <ScrollView style={{ maxHeight: 340 }}>
              {UNITS.map(u => {
                const active = value.unit === u;
                return (
                  <Pressable
                    key={u}
                    testID={`${testIDPrefix}-unit-${u}`}
                    onPress={() => { patch({ unit: u }); setUnitPickerOpen(false); Haptics.selectionAsync(); }}
                    style={[styles.unitOption, active && styles.unitOptionOn]}
                  >
                    <Text style={[styles.unitOptionTxt, active && styles.unitOptionTxtOn]}>{u}</Text>
                    {active && <Feather name="check" size={18} color={theme.color.brandPrimary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {showNotes && (
        <>
          <Text style={styles.label}>{t('common.notes')}</Text>
          <TextInput
            testID={`${testIDPrefix}-notes`}
            placeholder={t('spesa.notesPh')}
            placeholderTextColor={theme.color.onSurfaceTertiary}
            value={value.notes || ''}
            onChangeText={(text) => patch({ notes: text })}
            multiline
            style={[styles.input, styles.textarea]}
          />
        </>
      )}

      {showCategory && (
        <>
          <Text style={styles.label}>{t('spesa.category')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
            {cats.map(c => {
              const active = (value.category_id || 'altro') === c.id;
              return (
                <Pressable
                  key={c.id}
                  testID={`${testIDPrefix}-cat-${c.id}`}
                  onPress={() => { Haptics.selectionAsync(); patch({ category_id: c.id }); }}
                  style={[styles.catChip, active && styles.catChipActive]}
                >
                  <Text style={{ fontSize: 16 }}>{c.icon || '📦'}</Text>
                  <Text style={[styles.catChipTxt, active && { color: theme.color.brandPrimary, fontWeight: '600' }]}>{tCat(c)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      )}
    </View>
  );
}

/** Ingredient editor modal — used by DishEditor. */
export function IngredientEditorModal({
  open, initial, onCancel, onSave, onDelete,
}: {
  open: boolean;
  initial: IngredientDraft;
  onCancel: () => void;
  onSave: (v: IngredientDraft) => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<IngredientDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  // Reset when the modal opens
  useMemo(() => {
    if (open) { setDraft(initial); setErr(''); setConfirmDel(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = () => {
    if (!draft.name.trim()) { setErr(t('spesa.errors.name')); return; }
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSave({ ...draft, name: draft.name.trim() });
    setBusy(false);
  };

  return (
    <Modal
      visible={open}
      animationType="slide"
      onRequestClose={onCancel}
      presentationStyle="pageSheet"
    >
      <View style={mStyles.root} testID="ing-editor-modal">
        <View style={mStyles.header}>
          <Pressable onPress={onCancel} style={mStyles.hBtn} testID="ing-editor-cancel">
            <Feather name="x" size={22} color={theme.color.onSurface} />
          </Pressable>
          <Text style={mStyles.hTitle}>{t('piatti.ingredientEditor')}</Text>
          {onDelete ? (
            <Pressable onPress={() => setConfirmDel(true)} style={mStyles.hBtn} testID="ing-editor-delete">
              <Feather name="trash-2" size={20} color={theme.color.error} />
            </Pressable>
          ) : <View style={mStyles.hBtn} />}
        </View>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 120 }}>
          <IngredientEditorForm value={draft} onChange={setDraft} testIDPrefix="ing-modal" />
          {err ? <Text style={mStyles.err}>{err}</Text> : null}
        </ScrollView>
        <View style={mStyles.footer}>
          <Pressable
            onPress={save}
            disabled={busy}
            style={mStyles.saveBtn}
            testID="ing-editor-save"
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={mStyles.saveTxt}>{t('common.save')}</Text>}
          </Pressable>
        </View>

        {/* Delete confirmation */}
        <Modal transparent visible={confirmDel} animationType="fade" onRequestClose={() => setConfirmDel(false)}>
          <View style={mStyles.overlay}>
            <View style={mStyles.confirmCard} testID="ing-delete-confirm">
              <View style={mStyles.confirmIcon}>
                <Feather name="alert-triangle" size={22} color={theme.color.error} />
              </View>
              <Text style={mStyles.confirmH}>{t('piatti.ingDelete.title', { name: draft.name || t('piatti.ingredientNamePlaceholder') })}</Text>
              <Text style={mStyles.confirmP}>{t('piatti.ingDelete.body')}</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
                <Pressable onPress={() => setConfirmDel(false)} style={mStyles.btnGhost} testID="ing-delete-cancel">
                  <Text style={mStyles.btnGhostTxt}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => { setConfirmDel(false); onDelete?.(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); }}
                  style={mStyles.btnDanger}
                  testID="ing-delete-confirm-btn"
                >
                  <Text style={mStyles.btnDangerTxt}>{t('common.delete')}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.lg, marginBottom: 6, fontWeight: '500' },
  input: {
    minHeight: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    paddingHorizontal: theme.spacing.md, paddingVertical: 10, backgroundColor: theme.color.surfaceSecondary,
    color: theme.color.onSurface, fontSize: 15,
  },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  qtyInput: { flex: 1, textAlign: 'left', fontSize: 18, fontWeight: '600', letterSpacing: 0.3 },
  unitPickBtn: {
    minWidth: 92, paddingHorizontal: 12, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceSecondary,
  },
  unitPickTxt: { fontSize: 15, color: theme.color.onSurface, fontWeight: '600' },
  unitOverlay: { flex: 1, backgroundColor: 'rgba(44,40,38,0.4)', justifyContent: 'flex-end' },
  unitSheet: {
    backgroundColor: theme.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: theme.spacing.md, paddingBottom: theme.spacing.xl,
  },
  unitSheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: theme.color.border,
    alignSelf: 'center', marginBottom: 8,
  },
  unitSheetTitle: { fontFamily: theme.font.display, fontSize: 16, color: theme.color.onSurface, textAlign: 'center', marginBottom: 8 },
  unitOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: theme.color.divider,
  },
  unitOptionOn: { backgroundColor: theme.color.brandTertiary, borderRadius: theme.radius.md },
  unitOptionTxt: { fontSize: 16, color: theme.color.onSurface },
  unitOptionTxtOn: { color: theme.color.brandPrimary, fontWeight: '700' },
  catRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  catChipActive: { backgroundColor: theme.color.brandTertiary, borderColor: theme.color.brandPrimary },
  catChipTxt: { fontSize: 13, color: theme.color.onSurfaceSecondary },
});

const mStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  hBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hTitle: { flex: 1, textAlign: 'center', fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface },
  err: { color: theme.color.error, fontSize: 13, marginTop: theme.spacing.md },
  footer: { padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.color.divider, backgroundColor: theme.color.surface },
  saveBtn: { height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
  overlay: { flex: 1, backgroundColor: 'rgba(44,40,38,0.55)', alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  confirmCard: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, padding: theme.spacing.xl, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: theme.color.border },
  confirmIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F5E0DC', alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md },
  confirmH: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface, marginBottom: 6 },
  confirmP: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 18 },
  btnGhost: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  btnGhostTxt: { color: theme.color.onSurface, fontWeight: '500' },
  btnDanger: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.error, alignItems: 'center', justifyContent: 'center' },
  btnDangerTxt: { color: '#fff', fontWeight: '600' },
});
