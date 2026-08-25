import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Modal, Alert, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth, Course } from '@/src/auth';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { WEEK_START_OPTIONS } from '@/src/week';

type Msg = { kind: 'ok' | 'err'; text: string } | null;

export default function PreferencesSettings() {
  const router = useRouter();
  const { prefs, updatePreferences } = useAuth();

  const [weekStart, setWeekStart] = useState<number>(prefs.week_start_day);
  const [span, setSpan] = useState<'weekly' | 'biweekly'>(prefs.planner_span);
  const [courses, setCourses] = useState<Course[]>(prefs.courses);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [editing, setEditing] = useState<{ index: number | null; label: string } | null>(null);

  useEffect(() => {
    setWeekStart(prefs.week_start_day);
    setSpan(prefs.planner_span);
    setCourses(prefs.courses);
  }, [prefs]);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  const dirty = useMemo(() => {
    if (weekStart !== prefs.week_start_day) return true;
    if (span !== prefs.planner_span) return true;
    if (courses.length !== prefs.courses.length) return true;
    for (let i = 0; i < courses.length; i++) {
      if (courses[i].label !== prefs.courses[i]?.label) return true;
      if (courses[i].id !== prefs.courses[i]?.id) return true;
    }
    return false;
  }, [weekStart, span, courses, prefs]);

  const save = async () => {
    Keyboard.dismiss();
    setBusy(true);
    setMsg(null);
    try {
      await updatePreferences({ week_start_day: weekStart, planner_span: span, courses });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMsg({ kind: 'ok', text: 'Preferenze salvate.' });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || 'Errore salvataggio' });
    }
    setBusy(false);
  };

  const moveCourse = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= courses.length) return;
    Haptics.selectionAsync();
    const next = [...courses];
    [next[i], next[j]] = [next[j], next[i]];
    setCourses(next);
  };

  const removeCourse = (i: number) => {
    if (courses.length <= 1) {
      Alert.alert('Attenzione', 'Serve almeno una categoria.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCourses(prev => prev.filter((_, idx) => idx !== i));
  };

  const openAdd = () => setEditing({ index: null, label: '' });
  const openEdit = (i: number) => setEditing({ index: i, label: courses[i].label });

  const commitEdit = () => {
    if (!editing) return;
    const label = editing.label.trim();
    if (!label) return;
    if (label.length > 40) {
      Alert.alert('Attenzione', 'Massimo 40 caratteri per categoria.');
      return;
    }
    // Duplicate check (case-insensitive)
    const dupIdx = courses.findIndex((c, idx) =>
      c.label.trim().toLowerCase() === label.toLowerCase() && idx !== editing.index
    );
    if (dupIdx !== -1) {
      Alert.alert('Attenzione', 'Esiste già una categoria con questo nome.');
      return;
    }
    Haptics.selectionAsync();
    if (editing.index === null) {
      setCourses(prev => [...prev, { id: '', label }]);
    } else {
      setCourses(prev => prev.map((c, idx) => idx === editing.index ? { ...c, label } : c));
    }
    setEditing(null);
  };

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="settings-preferences">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back} testID="preferences-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={s.h1}>Preferenze</Text>
        <Pressable
          onPress={save}
          disabled={!dirty || busy}
          style={styles.saveHeader}
          testID="prefs-save"
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.color.brandPrimary} />
          ) : (
            <Text style={[
              styles.saveHeaderTxt,
              !dirty && { color: theme.color.onSurfaceTertiary },
            ]}>Salva</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAwareScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 60 }}>
        {/* Week start */}
        <View style={s.section}>
          <Text style={s.sectionH}>Inizio settimana</Text>
          <Text style={s.sectionSub}>
            Il Planner mostrerà i 7 giorni della settimana partendo dal giorno che scegli qui.
          </Text>
          <View style={styles.dayGrid}>
            {WEEK_START_OPTIONS.map(o => {
              const active = weekStart === o.value;
              return (
                <Pressable
                  key={o.value}
                  onPress={() => { Haptics.selectionAsync(); setWeekStart(o.value); }}
                  style={[styles.dayChip, active && styles.dayChipActive]}
                  testID={`day-chip-${o.value}`}
                >
                  <Text style={[styles.dayChipTxt, active && styles.dayChipTxtActive]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Planner span */}
        <View style={s.section}>
          <Text style={s.sectionH}>Durata del Planner</Text>
          <Text style={s.sectionSub}>
            Scegli se pianificare una settimana alla volta o due settimane in un colpo solo.
          </Text>
          <View style={styles.spanRow}>
            {([
              { key: 'weekly', label: 'Settimanale', sub: '7 giorni', icon: 'calendar' as const },
              { key: 'biweekly', label: 'Bi-settimanale', sub: '14 giorni', icon: 'columns' as const },
            ]).map(o => {
              const active = span === o.key;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => { Haptics.selectionAsync(); setSpan(o.key as any); }}
                  style={[styles.spanCard, active && styles.spanCardActive]}
                  testID={`span-${o.key}`}
                >
                  <View style={[styles.spanIcon, active && { backgroundColor: theme.color.brandPrimary }]}>
                    <Feather name={o.icon} size={18} color={active ? '#fff' : theme.color.brandPrimary} />
                  </View>
                  <Text style={[styles.spanLabel, active && { color: theme.color.brandPrimary, fontWeight: '700' }]}>{o.label}</Text>
                  <Text style={styles.spanSub}>{o.sub}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Courses */}
        <View style={s.section}>
          <Text style={s.sectionH}>Categorie dei piatti</Text>
          <Text style={s.sectionSub}>
            Personalizza come raggruppare i tuoi piatti (es. Primo, Secondo, Contorno, Dolce, Antipasto, Colazione…).
            L'ordine deciso qui è quello che vedi nella scheda Piatti e nel Planner.
          </Text>

          {courses.map((c, i) => (
            <View key={`${c.id || 'new'}_${i}`} style={styles.courseRow} testID={`course-row-${i}`}>
              <View style={styles.courseIcon}>
                <Feather name="tag" size={16} color={theme.color.brandPrimary} />
              </View>
              <Text style={styles.courseLabel} numberOfLines={1}>{c.label}</Text>
              <View style={styles.courseActions}>
                <Pressable
                  onPress={() => moveCourse(i, -1)}
                  disabled={i === 0}
                  style={[styles.iconBtn, i === 0 && { opacity: 0.3 }]}
                  testID={`course-up-${i}`}
                >
                  <Feather name="arrow-up" size={16} color={theme.color.onSurface} />
                </Pressable>
                <Pressable
                  onPress={() => moveCourse(i, 1)}
                  disabled={i === courses.length - 1}
                  style={[styles.iconBtn, i === courses.length - 1 && { opacity: 0.3 }]}
                  testID={`course-down-${i}`}
                >
                  <Feather name="arrow-down" size={16} color={theme.color.onSurface} />
                </Pressable>
                <Pressable onPress={() => openEdit(i)} style={styles.iconBtn} testID={`course-edit-${i}`}>
                  <Feather name="edit-2" size={16} color={theme.color.onSurface} />
                </Pressable>
                <Pressable onPress={() => removeCourse(i)} style={styles.iconBtn} testID={`course-remove-${i}`}>
                  <Feather name="x" size={16} color={theme.color.error} />
                </Pressable>
              </View>
            </View>
          ))}

          <Pressable onPress={openAdd} style={styles.addBtn} testID="course-add">
            <Feather name="plus" size={16} color={theme.color.brandPrimary} />
            <Text style={styles.addBtnTxt}>Aggiungi categoria</Text>
          </Pressable>

          <View style={styles.hint}>
            <Feather name="info" size={12} color={theme.color.onSurfaceTertiary} />
            <Text style={styles.hintTxt}>
              I piatti già creati mantengono la loro categoria anche se la rinomini. Se elimini una categoria, i piatti che la usano restano nel ricettario ma non appariranno in nessun filtro finché non li riassegni.
            </Text>
          </View>
        </View>

        {msg ? (
          <View style={[s.msgBox, msg.kind === 'err' ? s.msgErr : s.msgOk]} testID="prefs-msg">
            <Feather name={msg.kind === 'err' ? 'alert-circle' : 'check-circle'} size={16}
              color={msg.kind === 'err' ? theme.color.error : theme.color.success} />
            <Text style={[s.msgTxt, { color: msg.kind === 'err' ? theme.color.error : theme.color.success }]}>{msg.text}</Text>
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      {/* Edit/Add course modal */}
      <Modal transparent visible={!!editing} animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={s.overlay}>
          <View style={s.modalCard} testID="course-modal">
            <Text style={s.modalH}>
              {editing?.index === null ? 'Nuova categoria' : 'Rinomina categoria'}
            </Text>
            <Text style={s.modalP}>Es. Primo, Antipasto, Dolce, Merenda…</Text>
            <View style={{ height: theme.spacing.md }} />
            <TextInput
              testID="course-modal-input"
              placeholder="Nome categoria"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              value={editing?.label || ''}
              onChangeText={(t) => setEditing(prev => prev ? { ...prev, label: t } : prev)}
              autoFocus
              maxLength={40}
              style={s.input}
              onSubmitEditing={commitEdit}
              returnKeyType="done"
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.sm }}>
              <Pressable onPress={() => setEditing(null)} style={s.btnGhost} testID="course-modal-cancel">
                <Text style={s.btnGhostTxt}>Annulla</Text>
              </Pressable>
              <Pressable onPress={commitEdit} style={s.btnPrim} testID="course-modal-save">
                <Text style={s.btnDangerTxt}>{editing?.index === null ? 'Aggiungi' : 'Salva'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  saveHeader: { minWidth: 60, height: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
  saveHeaderTxt: { color: theme.color.brandPrimary, fontWeight: '600', fontSize: 15 },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: theme.spacing.sm },
  dayChip: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  dayChipActive: {
    backgroundColor: theme.color.brandTertiary,
    borderColor: theme.color.brandPrimary,
  },
  dayChipTxt: { fontSize: 14, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  dayChipTxtActive: { color: theme.color.brandPrimary, fontWeight: '600' },
  spanRow: { flexDirection: 'row', gap: 10, marginTop: theme.spacing.sm },
  spanCard: {
    flex: 1, padding: theme.spacing.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface,
    alignItems: 'flex-start', gap: 6,
  },
  spanCardActive: {
    borderColor: theme.color.brandPrimary, borderWidth: 2,
    backgroundColor: theme.color.brandTertiary,
  },
  spanIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: theme.color.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  spanLabel: { fontSize: 14, color: theme.color.onSurface, fontWeight: '600' },
  spanSub: { fontSize: 11, color: theme.color.onSurfaceTertiary },
  courseRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    paddingVertical: 8, paddingLeft: 12, paddingRight: 4,
    marginBottom: 8,
  },
  courseIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: theme.color.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  courseLabel: { flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: '500' },
  courseActions: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 10,
    marginTop: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.brandPrimary,
  },
  addBtnTxt: { color: theme.color.brandPrimary, fontWeight: '600', fontSize: 14 },
  hint: { flexDirection: 'row', gap: 6, marginTop: theme.spacing.md, alignItems: 'flex-start' },
  hintTxt: { flex: 1, fontSize: 11, color: theme.color.onSurfaceTertiary, lineHeight: 15 },
});
