import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Keyboard, Modal, ScrollView,
} from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { useAuth } from '@/src/auth';
import { useTranslation } from '@/src/i18n';
import { PhotoPicker, PhotoLightboxThumb } from '@/src/PhotoPicker';
import { IngredientEditorModal, type IngredientDraft } from '@/src/IngredientEditorForm';

type Ing = IngredientDraft;

type Props = {
  id?: string;
  initialCourse?: string;
};

export default function DishEditor({ id, initialCourse }: Props) {
  const router = useRouter();
  const params = useLocalSearchParams<{ course?: string; id?: string }>();
  const { prefs } = useAuth();
  const { t, tCourse, tCat } = useTranslation();
  const courses = prefs.courses;
  const ingCats = prefs.ingredient_categories;
  const dishId = id || (params.id as string | undefined);
  const startCourse = (params.course as string | undefined) || initialCourse || courses[0]?.id || 'primo';
  const defaultCatId = ingCats.find(c => c.id === 'altro')?.id || ingCats[ingCats.length - 1]?.id || 'altro';

  const [name, setName] = useState('');
  const [course, setCourse] = useState<string>(startCourse);
  const [servings, setServings] = useState(String(prefs.defaults?.default_servings || 1));
  const [ingredients, setIngredients] = useState<Ing[]>([]);
  const [preparation, setPreparation] = useState('');
  const [notes, setNotes] = useState('');
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!dishId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [editingIngIdx, setEditingIngIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!dishId || dishId === 'new') { setLoading(false); return; }
    (async () => {
      try {
        const d = await api.getDish(dishId);
        setName(d.name);
        setCourse(d.course);
        setServings(String(d.servings || 1));
        setPhotoPath(d.photo_path || null);
        setIngredients((d.ingredients || []).map((i: any) => ({
          name: i.name,
          quantity: String(i.quantity),
          unit: i.unit,
          category_id: i.category_id || defaultCatId,
          photo_path: i.photo_path || null,
        })));
        setPreparation(d.preparation || '');
        setNotes(d.notes || '');
      } catch {}
      setLoading(false);
    })();
  }, [dishId]);

  const addIng = () => {
    setIngredients(prev => [...prev, { name: '', quantity: '', unit: 'g', category_id: defaultCatId, photo_path: null }]);
    setEditingIngIdx(ingredients.length);
  };

  const save = async () => {
    Keyboard.dismiss();
    setErr('');
    if (!name.trim()) { setErr(t('piatti.errors.name')); return; }
    const validIngs = ingredients
      .filter(i => i.name.trim())
      .map(i => ({
        name: i.name.trim(),
        quantity: parseFloat((i.quantity || '0').replace(',', '.')) || 0,
        unit: i.unit,
        category_id: i.category_id || defaultCatId,
        photo_path: i.photo_path || null,
      }));
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        course,
        ingredients: validIngs,
        preparation,
        notes,
        servings: Math.max(1, parseInt(servings) || 1),
        photo_path: photoPath,
      };
      if (dishId && dishId !== 'new') await api.updateDish(dishId, body);
      else await api.createDish(body);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.back();
    } catch (e: any) {
      setErr(e.message || t('piatti.errors.save'));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!dishId || dishId === 'new') return;
    setDeleting(true);
    try {
      await api.deleteDish(dishId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setShowDelete(false);
      router.back();
    } catch {} finally { setDeleting(false); }
  };

  const duplicate = async () => {
    if (!dishId || dishId === 'new') return;
    setDuplicating(true);
    try {
      const nd = await api.duplicateDish(dishId);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.replace(`/dish/${nd.id}`);
    } catch {} finally { setDuplicating(false); }
  };

  if (loading) {
    return (
      <View style={styles.center}><ActivityIndicator color={theme.color.brandPrimary} /></View>
    );
  }

  const isEdit = !!(dishId && dishId !== 'new');
  const editingIng = editingIngIdx !== null ? ingredients[editingIngIdx] : null;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="dish-editor">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.hBtn} testID="dish-back">
          <Feather name="x" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.hTitle}>{isEdit ? t('piatti.editTitle') : t('piatti.newTitle')}</Text>
        {isEdit ? (
          <View style={{ flexDirection: 'row' }}>
            <Pressable onPress={duplicate} disabled={duplicating} style={styles.hBtn} testID="dish-duplicate">
              {duplicating ? <ActivityIndicator color={theme.color.onSurface} size="small" /> : <Feather name="copy" size={19} color={theme.color.onSurface} />}
            </Pressable>
            <Pressable onPress={() => setShowDelete(true)} style={styles.hBtn} testID="dish-delete">
              <Feather name="trash-2" size={20} color={theme.color.error} />
            </Pressable>
          </View>
        ) : <View style={styles.hBtn} />}
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 160 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={80}
      >
          <View style={{ alignItems: 'center', marginBottom: theme.spacing.sm }}>
            <PhotoPicker value={photoPath} onChange={setPhotoPath} size={120} testID="dish-photo" />
          </View>

          <Text style={styles.label}>{t('piatti.field.name')}</Text>
          <TextInput
            testID="dish-name"
            value={name} onChangeText={setName}
            placeholder={t('piatti.dishNamePlaceholder')}
            placeholderTextColor={theme.color.onSurfaceTertiary}
            style={styles.input}
          />

          <Text style={styles.label}>{t('piatti.field.course')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {courses.map(c => (
              <Pressable
                key={c.id}
                testID={`course-${c.id}`}
                onPress={() => setCourse(c.id)}
                style={[styles.chip, course === c.id && styles.chipActive]}
              >
                <Text style={[styles.chipTxt, course === c.id && styles.chipTxtActive]}>{tCourse(c)}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={styles.label}>{t('piatti.field.servings')}</Text>
          <TextInput
            testID="dish-servings"
            value={servings} onChangeText={setServings}
            keyboardType="numeric"
            style={[styles.input, { width: 100 }]}
          />
          <Text style={styles.helper}>{t('piatti.field.servingsHelper')}</Text>

          <Text style={styles.label}>{t('piatti.field.ingredients')}</Text>
          {ingredients.length === 0 && (
            <Text style={styles.emptyIng}>{t('piatti.noIngredients')}</Text>
          )}
          {ingredients.map((ing, i) => {
            const cat = ingCats.find(c => c.id === (ing.category_id || defaultCatId));
            return (
              <Pressable
                key={i}
                onPress={() => setEditingIngIdx(i)}
                style={styles.ingRow}
                testID={`ing-row-${i}`}
              >
                <PhotoLightboxThumb
                  path={ing.photo_path}
                  size={40}
                  rounded
                  fallbackEmoji={cat?.icon || '📦'}
                  fallbackIcon="package"
                  testID={`ing-thumb-${i}`}
                />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.ingName} numberOfLines={1}>
                    {ing.name || t('piatti.ingredientNamePlaceholder')}
                  </Text>
                  <View style={styles.ingMeta}>
                    <Text style={styles.ingMetaTxt}>
                      {ing.quantity ? `${ing.quantity} ${ing.unit}` : `— ${ing.unit}`}
                    </Text>
                    {cat && (
                      <>
                        <Text style={styles.ingMetaSep}>·</Text>
                        <Text style={styles.ingMetaTxt}>{cat.icon || '📦'} {tCat(cat)}</Text>
                      </>
                    )}
                  </View>
                </View>
                <Feather name="chevron-right" size={18} color={theme.color.onSurfaceTertiary} />
              </Pressable>
            );
          })}
          <Pressable onPress={addIng} style={styles.addIng} testID="add-ingredient">
            <Feather name="plus" size={16} color={theme.color.brandPrimary} />
            <Text style={styles.addIngTxt}>{t('piatti.addIngredient')}</Text>
          </Pressable>

          <Text style={styles.label}>{t('piatti.field.preparation')}</Text>
          <TextInput
            testID="dish-prep"
            value={preparation} onChangeText={setPreparation}
            placeholder={t('piatti.field.preparationPh')}
            placeholderTextColor={theme.color.onSurfaceTertiary}
            multiline
            style={[styles.input, styles.textarea]}
          />

          <Text style={styles.label}>{t('common.notes')}</Text>
          <TextInput
            testID="dish-notes"
            value={notes} onChangeText={setNotes}
            placeholder={t('piatti.field.notesPh')}
            placeholderTextColor={theme.color.onSurfaceTertiary}
            multiline
            style={[styles.input, styles.textareaSm]}
          />

          {err ? <Text style={styles.err} testID="dish-error">{err}</Text> : null}
        </KeyboardAwareScrollView>

        <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
          <View style={styles.saveWrap}>
            <Pressable onPress={save} disabled={busy} style={styles.saveBtn} testID="dish-save">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>{t('piatti.saveDish')}</Text>}
            </Pressable>
          </View>
        </KeyboardStickyView>

        {/* Delete confirmation */}
        <Modal
          transparent
          visible={showDelete}
          animationType="fade"
          onRequestClose={() => setShowDelete(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard} testID="confirm-dish-delete-modal">
              <View style={styles.modalIcon}>
                <Feather name="alert-triangle" size={24} color={theme.color.error} />
              </View>
              <Text style={styles.modalH}>{t('piatti.deleteConfirm.title', { name })}</Text>
              <Text style={styles.modalP}>{t('piatti.deleteConfirm.body')}</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
                <Pressable onPress={() => setShowDelete(false)} style={styles.btnGhost} testID="dish-delete-cancel" disabled={deleting}>
                  <Text style={styles.btnGhostTxt}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable onPress={del} style={styles.btnDanger} testID="dish-delete-confirm" disabled={deleting}>
                  {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnDangerTxt}>{t('common.delete')}</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* Full-page ingredient editor modal */}
        {editingIng !== null && (
          <IngredientEditorModal
            open={editingIngIdx !== null}
            initial={editingIng}
            onCancel={() => {
              // If ingredient is empty (freshly added), remove it
              if (editingIngIdx !== null) {
                const cur = ingredients[editingIngIdx];
                if (!cur.name.trim()) {
                  setIngredients(prev => prev.filter((_, i) => i !== editingIngIdx));
                }
              }
              setEditingIngIdx(null);
            }}
            onSave={(v) => {
              setIngredients(prev => prev.map((it, i) => i === editingIngIdx ? v : it));
              setEditingIngIdx(null);
            }}
            onDelete={() => {
              setIngredients(prev => prev.filter((_, i) => i !== editingIngIdx));
              setEditingIngIdx(null);
            }}
          />
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.color.divider, backgroundColor: theme.color.surface },
  hBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hTitle: { flex: 1, textAlign: 'center', fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface },
  label: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.lg, marginBottom: 6, fontWeight: '500' },
  helper: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 4 },
  emptyIng: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontStyle: 'italic', marginBottom: 6 },
  input: {
    minHeight: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    paddingHorizontal: theme.spacing.md, paddingVertical: 10, backgroundColor: theme.color.surfaceSecondary,
    color: theme.color.onSurface, fontSize: 15,
  },
  textarea: { minHeight: 130, textAlignVertical: 'top' },
  textareaSm: { minHeight: 80, textAlignVertical: 'top' },
  chipsRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  chipActive: { backgroundColor: theme.color.brandTertiary, borderColor: theme.color.brandPrimary },
  chipTxt: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  chipTxtActive: { color: theme.color.brandPrimary, fontWeight: '600' },
  ingRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 10, marginBottom: 8,
    borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
  },
  ingName: { fontSize: 15, color: theme.color.onSurface, fontWeight: '500' },
  ingMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  ingMetaTxt: { fontSize: 12, color: theme.color.onSurfaceSecondary },
  ingMetaSep: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginHorizontal: 6 },
  addIng: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 4, paddingVertical: 8 },
  addIngTxt: { color: theme.color.brandPrimary, fontWeight: '500', fontSize: 14 },
  err: { color: theme.color.error, fontSize: 13, marginTop: theme.spacing.md },
  saveWrap: { padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.color.divider, backgroundColor: theme.color.surface },
  saveBtn: { height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(44,40,38,0.55)', alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  modalCard: { backgroundColor: theme.color.surface, borderRadius: theme.radius.lg, padding: theme.spacing.xl, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: theme.color.border },
  modalIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F5E0DC', alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md },
  modalH: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface, marginBottom: 6 },
  modalP: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 18 },
  btnGhost: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  btnGhostTxt: { color: theme.color.onSurface, fontWeight: '500' },
  btnDanger: { flex: 1, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.error, alignItems: 'center', justifyContent: 'center' },
  btnDangerTxt: { color: '#fff', fontWeight: '600' },
});
