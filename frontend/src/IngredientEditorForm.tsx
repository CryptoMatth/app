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
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { theme } from './theme';
import { useAuth } from './auth';
import { useTranslation } from './i18n';
import { PhotoPicker } from './PhotoPicker';

export const UNITS = ['g', 'kg', 'ml', 'l', 'pz', 'cucchiaio', 'q.b.'];

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
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TextInput
          testID={`${testIDPrefix}-qty`}
          placeholder={t('spesa.qty')}
          placeholderTextColor={theme.color.onSurfaceTertiary}
          value={value.quantity}
          onChangeText={(text) => patch({ quantity: text })}
          keyboardType="numeric"
          style={[styles.input, { flex: 1 }]}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unitRow}>
          {UNITS.map(u => {
            const active = value.unit === u;
            return (
              <Pressable
                key={u}
                testID={`${testIDPrefix}-unit-${u}`}
                onPress={() => patch({ unit: u })}
                style={[styles.unitBtn, active && styles.unitBtnOn]}
              >
                <Text style={[styles.unitTxt, active && styles.unitTxtOn]}>{u}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

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

  // Reset when the modal opens
  useMemo(() => {
    if (open) { setDraft(initial); setErr(''); }
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
            <Pressable onPress={onDelete} style={mStyles.hBtn} testID="ing-editor-delete">
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
  unitRow: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  unitBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radius.sm, minWidth: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border },
  unitBtnOn: { backgroundColor: theme.color.brandTertiary, borderColor: theme.color.brandPrimary },
  unitTxt: { fontSize: 12, color: theme.color.onSurfaceSecondary },
  unitTxtOn: { color: theme.color.brandPrimary, fontWeight: '600' },
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
});
