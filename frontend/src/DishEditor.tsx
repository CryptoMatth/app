import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Keyboard, Modal,
} from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

type Ing = { name: string; quantity: string; unit: string };
const UNITS = ['g', 'kg', 'ml', 'l', 'pz', 'cucchiaio', 'q.b.'];

type Props = {
  id?: string;
  initialCourse?: 'primo' | 'secondo';
};

export default function DishEditor({ id, initialCourse = 'primo' }: Props) {
  const router = useRouter();
  const params = useLocalSearchParams<{ course?: string; id?: string }>();
  const dishId = id || (params.id as string | undefined);
  const startCourse = (params.course as 'primo' | 'secondo' | undefined) || initialCourse;

  const [name, setName] = useState('');
  const [course, setCourse] = useState<'primo' | 'secondo'>(startCourse);
  const [servings, setServings] = useState('1');
  const [ingredients, setIngredients] = useState<Ing[]>([{ name: '', quantity: '', unit: 'g' }]);
  const [preparation, setPreparation] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(!!dishId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  useEffect(() => {
    if (!dishId || dishId === 'new') { setLoading(false); return; }
    (async () => {
      try {
        const d = await api.getDish(dishId);
        setName(d.name);
        setCourse(d.course);
        setServings(String(d.servings || 1));
        setIngredients((d.ingredients || []).length > 0
          ? d.ingredients.map((i: any) => ({ name: i.name, quantity: String(i.quantity), unit: i.unit }))
          : [{ name: '', quantity: '', unit: 'g' }]);
        setPreparation(d.preparation || '');
        setNotes(d.notes || '');
      } catch {}
      setLoading(false);
    })();
  }, [dishId]);

  const addIng = () => setIngredients(prev => [...prev, { name: '', quantity: '', unit: 'g' }]);
  const removeIng = (i: number) => setIngredients(prev => prev.filter((_, idx) => idx !== i));
  const updateIng = (i: number, patch: Partial<Ing>) =>
    setIngredients(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));

  const save = async () => {
    Keyboard.dismiss();
    setErr('');
    if (!name.trim()) { setErr('Inserisci il nome del piatto'); return; }
    const validIngs = ingredients
      .filter(i => i.name.trim())
      .map(i => ({
        name: i.name.trim(),
        quantity: parseFloat((i.quantity || '0').replace(',', '.')) || 0,
        unit: i.unit,
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
      };
      if (dishId && dishId !== 'new') await api.updateDish(dishId, body);
      else await api.createDish(body);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.back();
    } catch (e: any) {
      setErr(e.message || 'Errore salvataggio');
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

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="dish-editor">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.hBtn} testID="dish-back">
          <Feather name="x" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.hTitle}>{dishId && dishId !== 'new' ? 'Modifica piatto' : 'Nuovo piatto'}</Text>
        {dishId && dishId !== 'new' ? (
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
          <Text style={styles.label}>Nome</Text>
          <TextInput
            testID="dish-name"
            value={name} onChangeText={setName}
            placeholder="es. Spaghetti al pomodoro"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            style={styles.input}
          />

          <Text style={styles.label}>Portata</Text>
          <View style={styles.seg}>
            {(['primo', 'secondo'] as const).map(c => (
              <Pressable key={c} testID={`course-${c}`} onPress={() => setCourse(c)} style={[styles.segBtn, course === c && styles.segBtnActive]}>
                <Text style={[styles.segTxt, course === c && styles.segTxtActive]}>{c === 'primo' ? 'Primo' : 'Secondo'}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Porzioni della ricetta</Text>
          <TextInput
            testID="dish-servings"
            value={servings} onChangeText={setServings}
            keyboardType="numeric"
            style={[styles.input, { width: 100 }]}
          />
          <Text style={styles.helper}>Numero di persone per cui è pensata la ricetta.</Text>

          <Text style={styles.label}>Ingredienti</Text>
          {ingredients.map((ing, i) => (
            <View key={i} style={styles.ingRow} testID={`ing-row-${i}`}>
              <TextInput
                testID={`ing-name-${i}`}
                value={ing.name} onChangeText={t => updateIng(i, { name: t })}
                placeholder="Ingrediente"
                placeholderTextColor={theme.color.onSurfaceTertiary}
                style={[styles.input, { flex: 1 }]}
              />
              <TextInput
                testID={`ing-qty-${i}`}
                value={ing.quantity} onChangeText={t => updateIng(i, { quantity: t })}
                placeholder="Q.tà"
                placeholderTextColor={theme.color.onSurfaceTertiary}
                keyboardType="numeric"
                style={[styles.input, { width: 70 }]}
              />
              <View style={styles.unitBox}>
                <UnitDropdown value={ing.unit} onChange={u => updateIng(i, { unit: u })} testID={`ing-unit-${i}`} />
              </View>
              {ingredients.length > 1 && (
                <Pressable onPress={() => removeIng(i)} style={styles.iconBtn} testID={`ing-remove-${i}`}>
                  <Feather name="x" size={18} color={theme.color.onSurfaceTertiary} />
                </Pressable>
              )}
            </View>
          ))}
          <Pressable onPress={addIng} style={styles.addIng} testID="add-ingredient">
            <Feather name="plus" size={16} color={theme.color.brandPrimary} />
            <Text style={styles.addIngTxt}>Aggiungi ingrediente</Text>
          </Pressable>

          <Text style={styles.label}>Preparazione</Text>
          <TextInput
            testID="dish-prep"
            value={preparation} onChangeText={setPreparation}
            placeholder="Descrivi come preparare il piatto..."
            placeholderTextColor={theme.color.onSurfaceTertiary}
            multiline
            style={[styles.input, styles.textarea]}
          />

          <Text style={styles.label}>Note</Text>
          <TextInput
            testID="dish-notes"
            value={notes} onChangeText={setNotes}
            placeholder="Es. piace tanto a Giulia, usa basilico fresco..."
            placeholderTextColor={theme.color.onSurfaceTertiary}
            multiline
            style={[styles.input, styles.textareaSm]}
          />

          {err ? <Text style={styles.err} testID="dish-error">{err}</Text> : null}
        </KeyboardAwareScrollView>

        <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
          <View style={styles.saveWrap}>
            <Pressable onPress={save} disabled={busy} style={styles.saveBtn} testID="dish-save">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Salva piatto</Text>}
            </Pressable>
          </View>
        </KeyboardStickyView>

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
              <Text style={styles.modalH}>Eliminare "{name}"?</Text>
              <Text style={styles.modalP}>
                Il piatto sarà eliminato dal ricettario. Le settimane già pianificate che lo contengono manterranno il nome ma non potrai più modificarlo.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
                <Pressable
                  onPress={() => setShowDelete(false)}
                  style={styles.btnGhost}
                  testID="dish-delete-cancel"
                  disabled={deleting}
                >
                  <Text style={styles.btnGhostTxt}>Annulla</Text>
                </Pressable>
                <Pressable
                  onPress={del}
                  style={styles.btnDanger}
                  testID="dish-delete-confirm"
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

function UnitDropdown({ value, onChange, testID }: { value: string; onChange: (u: string) => void; testID?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable onPress={() => setOpen(o => !o)} style={styles.unitTrigger} testID={testID}>
        <Text style={styles.unitTriggerTxt}>{value}</Text>
        <Feather name="chevron-down" size={14} color={theme.color.onSurfaceTertiary} />
      </Pressable>
      {open && (
        <View style={styles.unitMenu}>
          {UNITS.map(u => (
            <Pressable key={u} onPress={() => { onChange(u); setOpen(false); }} style={styles.unitOpt}>
              <Text style={[styles.unitOptTxt, u === value && { color: theme.color.brandPrimary, fontWeight: '600' }]}>{u}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
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
  input: {
    minHeight: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    paddingHorizontal: theme.spacing.md, paddingVertical: 10, backgroundColor: theme.color.surfaceSecondary,
    color: theme.color.onSurface, fontSize: 15,
  },
  textarea: { minHeight: 130, textAlignVertical: 'top' },
  textareaSm: { minHeight: 80, textAlignVertical: 'top' },
  seg: { flexDirection: 'row', backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, padding: 4 },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: theme.radius.pill },
  segBtnActive: { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  segTxt: { fontSize: 14, color: theme.color.onSurfaceSecondary },
  segTxtActive: { color: theme.color.brandPrimary, fontWeight: '600' },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  unitBox: {},
  unitTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 46, paddingHorizontal: 10, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary,
    minWidth: 70, justifyContent: 'space-between',
  },
  unitTriggerTxt: { fontSize: 13, color: theme.color.onSurface },
  unitMenu: {
    position: 'absolute', top: 50, right: 0, backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    paddingVertical: 4, zIndex: 100, elevation: 6, minWidth: 110,
  },
  unitOpt: { paddingVertical: 8, paddingHorizontal: 12 },
  unitOptTxt: { fontSize: 14, color: theme.color.onSurface },
  iconBtn: { width: 34, height: 46, alignItems: 'center', justifyContent: 'center' },
  addIng: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 4 },
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
