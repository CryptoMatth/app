import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { theme } from '@/src/theme';

const UNITS = ['g', 'kg', 'ml', 'l', 'pz', 'cucchiaio', 'q.b.'];

type Props = { id?: string };

export default function ShoppingEditor({ id }: Props) {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const itemId = id || (params.id as string | undefined);
  const isNew = !itemId || itemId === 'new';

  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('g');
  const [notes, setNotes] = useState('');
  const [plannerQty, setPlannerQty] = useState(0);
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        // No dedicated GET; fetch list and find
        const list = await api.listShopping();
        const it = list.find((x: any) => x.id === itemId);
        if (it) {
          setName(it.name || '');
          setQty(String(it.manual_qty || 0));
          setUnit(it.unit || 'g');
          setNotes(it.notes || '');
          setPlannerQty(it.planner_qty || 0);
        }
      } catch {}
      setLoading(false);
    })();
  }, [itemId, isNew]);

  const save = async () => {
    Keyboard.dismiss();
    setErr('');
    if (!name.trim()) { setErr('Inserisci un nome'); return; }
    const q = parseFloat((qty || '0').replace(',', '.'));
    if (!isNew && qty === '') {
      // OK - keep existing manual_qty as-is via undefined
    } else if (isNaN(q) || q < 0) {
      setErr('Quantità non valida'); return;
    }
    setBusy(true);
    try {
      if (isNew) {
        if (q <= 0) { setErr('La quantità deve essere maggiore di zero'); setBusy(false); return; }
        await api.addManual(name.trim(), q, unit, notes);
      } else {
        await api.editShopping(itemId!, {
          name: name.trim(),
          quantity: q,
          unit,
          notes,
        });
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.back();
    } catch (e: any) {
      setErr(e.message || 'Errore salvataggio');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <View style={styles.centerLoad}><ActivityIndicator color={theme.color.brandPrimary} /></View>;
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="shopping-editor">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.hBtn} testID="shopping-back">
          <Feather name="x" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.hTitle}>{isNew ? 'Nuovo ingrediente' : 'Modifica ingrediente'}</Text>
        <View style={styles.hBtn} />
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 160 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={80}
      >
        <Text style={styles.label}>Nome</Text>
        <TextInput
          testID="shop-name-input"
          placeholder="Nome ingrediente (es. pomodoro)"
          placeholderTextColor={theme.color.onSurfaceTertiary}
          value={name} onChangeText={setName}
          style={styles.input}
          autoFocus={isNew}
        />

        <Text style={styles.label}>
          Quantità {plannerQty > 0 ? `manuale (+${plannerQty}${unit} dal planner)` : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextInput
            testID="shop-qty-input"
            placeholder="Quantità"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            value={qty} onChangeText={setQty}
            keyboardType="numeric"
            style={[styles.input, { flex: 1 }]}
          />
          <View style={styles.unitPicker}>
            {UNITS.slice(0, 5).map(u => (
              <Pressable
                key={u}
                testID={`shop-unit-${u}`}
                onPress={() => setUnit(u)}
                style={[styles.unitBtn, unit === u && styles.unitBtnOn]}
              >
                <Text style={[styles.unitTxt, unit === u && styles.unitTxtOn]}>{u}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={styles.label}>Note</Text>
        <TextInput
          testID="shop-notes-input"
          placeholder="Es. marca preferita, biologico, sotto sale..."
          placeholderTextColor={theme.color.onSurfaceTertiary}
          value={notes} onChangeText={setNotes}
          multiline
          style={[styles.input, styles.textarea]}
        />

        {err ? <Text style={styles.err} testID="shop-error">{err}</Text> : null}
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View style={styles.saveWrap}>
          <Pressable onPress={save} disabled={busy} style={styles.saveBtn} testID="shop-save">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>{isNew ? 'Aggiungi' : 'Salva modifiche'}</Text>}
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
  label: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.lg, marginBottom: 6, fontWeight: '500' },
  input: {
    minHeight: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    paddingHorizontal: theme.spacing.md, paddingVertical: 10, backgroundColor: theme.color.surfaceSecondary,
    color: theme.color.onSurface, fontSize: 15,
  },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  unitPicker: { flexDirection: 'row', gap: 4, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: 3 },
  unitBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radius.sm, minWidth: 34, alignItems: 'center', justifyContent: 'center' },
  unitBtnOn: { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  unitTxt: { fontSize: 12, color: theme.color.onSurfaceSecondary },
  unitTxtOn: { color: theme.color.brandPrimary, fontWeight: '600' },
  err: { color: theme.color.error, fontSize: 13, marginTop: theme.spacing.md },
  saveWrap: { padding: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.color.divider, backgroundColor: theme.color.surface },
  saveBtn: { height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
