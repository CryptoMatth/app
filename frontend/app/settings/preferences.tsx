import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Modal, Alert, Keyboard, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth, Course, IngredientCategory, NotificationPrefs } from '@/src/auth';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { weekStartOptions } from '@/src/week';
import { useTranslation } from '@/src/i18n';
import { useIsPro, ProUpsellModal } from '@/src/ProGate';

type Msg = { kind: 'ok' | 'err'; text: string } | null;

type EditingCat =
  | null
  | {
      kind: 'course';
      index: number | null;
      label: string;
    }
  | {
      kind: 'ing';
      index: number | null;
      label: string;
      icon: string;
    };

const EMOJI_SUGGESTIONS = ['🥬', '🍎', '🥩', '🥛', '🍞', '❄️', '🥤', '🫙', '📦', '🍫', '🌶️', '🫒', '🥫', '🐟', '🥚', '🌰', '🧀'];

export default function PreferencesSettings() {
  const router = useRouter();
  const { t, lang, tCourse, tCat } = useTranslation();
  const { prefs, updatePreferences } = useAuth();
  const WEEK_START_OPTS = weekStartOptions(lang);

  const [weekStart, setWeekStart] = useState<number>(prefs.week_start_day);
  const [span, setSpan] = useState<'weekly' | 'biweekly'>(prefs.planner_span);
  const [language, setLanguage] = useState<'it' | 'en'>(prefs.language);
  const [courses, setCourses] = useState<Course[]>(prefs.courses);
  const [ingCats, setIngCats] = useState<IngredientCategory[]>(prefs.ingredient_categories);
  const [notif, setNotif] = useState<NotificationPrefs>(prefs.notifications || { enabled: false, expiry_days_ahead: 1, notify_hour: 9, freezer_enabled: true });
  const isPro = useIsPro();
  const [upsell, setUpsell] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [editing, setEditing] = useState<EditingCat>(null);

  useEffect(() => {
    setWeekStart(prefs.week_start_day);
    setSpan(prefs.planner_span);
    setLanguage(prefs.language);
    setCourses(prefs.courses);
    setIngCats(prefs.ingredient_categories);
    setNotif(prefs.notifications || { enabled: false, expiry_days_ahead: 1, notify_hour: 9, freezer_enabled: true });
  }, [prefs]);
  useEffect(() => {
    if (!msg) return;
    const timer = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [msg]);

  const dirty = useMemo(() => {
    if (weekStart !== prefs.week_start_day) return true;
    if (span !== prefs.planner_span) return true;
    if (language !== prefs.language) return true;
    if (courses.length !== prefs.courses.length) return true;
    for (let i = 0; i < courses.length; i++) {
      if (courses[i].label !== prefs.courses[i]?.label) return true;
      if (courses[i].id !== prefs.courses[i]?.id) return true;
    }
    if (ingCats.length !== prefs.ingredient_categories.length) return true;
    for (let i = 0; i < ingCats.length; i++) {
      if (ingCats[i].label !== prefs.ingredient_categories[i]?.label) return true;
      if (ingCats[i].id !== prefs.ingredient_categories[i]?.id) return true;
      if ((ingCats[i].icon || '') !== (prefs.ingredient_categories[i]?.icon || '')) return true;
    }
    const pn = prefs.notifications || { enabled: false, expiry_days_ahead: 1, notify_hour: 9, freezer_enabled: true };
    if (notif.enabled !== pn.enabled) return true;
    if (notif.expiry_days_ahead !== pn.expiry_days_ahead) return true;
    if (notif.notify_hour !== pn.notify_hour) return true;
    if (notif.freezer_enabled !== pn.freezer_enabled) return true;
    return false;
  }, [weekStart, span, language, courses, ingCats, notif, prefs]);

  const save = async () => {
    Keyboard.dismiss();
    setBusy(true);
    setMsg(null);
    try {
      await updatePreferences({
        week_start_day: weekStart,
        planner_span: span,
        language,
        courses,
        ingredient_categories: ingCats,
        notifications: notif,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMsg({ kind: 'ok', text: t('prefs.saved') });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message || t('prefs.errors.saveGen') });
    }
    setBusy(false);
  };

  const moveInList = <T,>(arr: T[], setter: (v: T[]) => void, i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    Haptics.selectionAsync();
    const next = [...arr];
    [next[i], next[j]] = [next[j], next[i]];
    setter(next);
  };

  const removeFromList = <T,>(arr: T[], setter: (v: T[]) => void, i: number) => {
    if (arr.length <= 1) { Alert.alert('!', t('prefs.errors.minOne')); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setter(arr.filter((_, idx) => idx !== i));
  };

  const commitEdit = () => {
    if (!editing) return;
    const label = editing.label.trim();
    if (!label) return;
    if (label.length > 40) { Alert.alert('!', t('prefs.errors.tooMany')); return; }
    Haptics.selectionAsync();
    if (editing.kind === 'course') {
      // duplicate check
      const dup = courses.findIndex((c, idx) =>
        c.label.trim().toLowerCase() === label.toLowerCase() && idx !== editing.index
      );
      if (dup !== -1) { Alert.alert('!', t('prefs.errors.duplicate')); return; }
      if (editing.index === null) setCourses(prev => [...prev, { id: '', label }]);
      else setCourses(prev => prev.map((c, i) => i === editing.index ? { ...c, label } : c));
    } else {
      const dup = ingCats.findIndex((c, idx) =>
        c.label.trim().toLowerCase() === label.toLowerCase() && idx !== editing.index
      );
      if (dup !== -1) { Alert.alert('!', t('prefs.errors.duplicate')); return; }
      const icon = (editing.icon || '').trim().slice(0, 4) || null;
      if (editing.index === null) setIngCats(prev => [...prev, { id: '', label, icon, color: null }]);
      else setIngCats(prev => prev.map((c, i) => i === editing.index ? { ...c, label, icon } : c));
    }
    setEditing(null);
  };

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="settings-preferences">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back} testID="preferences-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={s.h1}>{t('prefs.header')}</Text>
        <Pressable onPress={save} disabled={!dirty || busy} style={styles.saveHeader} testID="prefs-save">
          {busy ? (
            <ActivityIndicator size="small" color={theme.color.brandPrimary} />
          ) : (
            <Text style={[styles.saveHeaderTxt, !dirty && { color: theme.color.onSurfaceTertiary }]}>
              {t('common.save')}
            </Text>
          )}
        </Pressable>
      </View>

      <KeyboardAwareScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 60 }}>
        {/* Language */}
        <View style={s.section}>
          <Text style={s.sectionH}>{t('prefs.language.h')}</Text>
          <Text style={s.sectionSub}>{t('prefs.language.sub')}</Text>
          <View style={styles.spanRow}>
            {[
              { key: 'it', label: '🇮🇹  Italiano' },
              { key: 'en', label: '🇬🇧  English' },
            ].map(o => {
              const active = language === o.key;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => { Haptics.selectionAsync(); setLanguage(o.key as any); }}
                  style={[styles.spanCard, active && styles.spanCardActive]}
                  testID={`lang-${o.key}`}
                >
                  <Text style={[styles.spanLabel, active && { color: theme.color.brandPrimary, fontWeight: '700' }]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Week start */}
        <View style={s.section}>
          <Text style={s.sectionH}>{t('prefs.weekStart.h')}</Text>
          <Text style={s.sectionSub}>{t('prefs.weekStart.sub')}</Text>
          <View style={styles.dayGrid}>
            {WEEK_START_OPTS.map(o => {
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
          <Text style={s.sectionH}>{t('prefs.span.h')}</Text>
          <Text style={s.sectionSub}>{t('prefs.span.sub')}</Text>
          <View style={styles.spanRow}>
            {([
              { key: 'weekly', label: t('prefs.span.weekly'), sub: t('prefs.span.weeklySub'), icon: 'calendar' as const },
              { key: 'biweekly', label: t('prefs.span.biweekly'), sub: t('prefs.span.biweeklySub'), icon: 'columns' as const },
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

        {/* Dish courses */}
        <View style={s.section}>
          <Text style={s.sectionH}>{t('prefs.courses.h')}</Text>
          <Text style={s.sectionSub}>{t('prefs.courses.sub')}</Text>
          {courses.map((c, i) => (
            <View key={`c_${c.id || 'new'}_${i}`} style={styles.courseRow} testID={`course-row-${i}`}>
              <View style={[styles.courseIcon, { backgroundColor: theme.color.brandTertiary }]}>
                <Feather name="tag" size={16} color={theme.color.brandPrimary} />
              </View>
              <Text style={styles.courseLabel} numberOfLines={1}>{tCourse(c)}</Text>
              <View style={styles.courseActions}>
                <Pressable onPress={() => moveInList(courses, setCourses, i, -1)} disabled={i === 0}
                  style={[styles.iconBtn, i === 0 && { opacity: 0.3 }]} testID={`course-up-${i}`}>
                  <Feather name="arrow-up" size={16} color={theme.color.onSurface} />
                </Pressable>
                <Pressable onPress={() => moveInList(courses, setCourses, i, 1)} disabled={i === courses.length - 1}
                  style={[styles.iconBtn, i === courses.length - 1 && { opacity: 0.3 }]} testID={`course-down-${i}`}>
                  <Feather name="arrow-down" size={16} color={theme.color.onSurface} />
                </Pressable>
                <Pressable onPress={() => setEditing({ kind: 'course', index: i, label: tCourse(c) })}
                  style={styles.iconBtn} testID={`course-edit-${i}`}>
                  <Feather name="edit-2" size={16} color={theme.color.onSurface} />
                </Pressable>
                <Pressable onPress={() => removeFromList(courses, setCourses, i)} style={styles.iconBtn} testID={`course-remove-${i}`}>
                  <Feather name="x" size={16} color={theme.color.error} />
                </Pressable>
              </View>
            </View>
          ))}
          <Pressable onPress={() => setEditing({ kind: 'course', index: null, label: '' })} style={styles.addBtn} testID="course-add">
            <Feather name="plus" size={16} color={theme.color.brandPrimary} />
            <Text style={styles.addBtnTxt}>{t('prefs.addCategory')}</Text>
          </Pressable>
        </View>

        {/* Ingredient categories */}
        <View style={s.section}>
          <Text style={s.sectionH}>{t('prefs.ingCats.h')}</Text>
          <Text style={s.sectionSub}>{t('prefs.ingCats.sub')}</Text>
          {ingCats.map((c, i) => (
            <View key={`ic_${c.id || 'new'}_${i}`} style={styles.courseRow} testID={`ing-row-${i}`}>
              <View style={[styles.courseIcon, { backgroundColor: c.color || theme.color.brandTertiary }]}>
                <Text style={{ fontSize: 16 }}>{c.icon || '📦'}</Text>
              </View>
              <Text style={styles.courseLabel} numberOfLines={1}>{tCat(c)}</Text>
              <View style={styles.courseActions}>
                <Pressable onPress={() => moveInList(ingCats, setIngCats, i, -1)} disabled={i === 0}
                  style={[styles.iconBtn, i === 0 && { opacity: 0.3 }]} testID={`ing-up-${i}`}>
                  <Feather name="arrow-up" size={16} color={theme.color.onSurface} />
                </Pressable>
                <Pressable onPress={() => moveInList(ingCats, setIngCats, i, 1)} disabled={i === ingCats.length - 1}
                  style={[styles.iconBtn, i === ingCats.length - 1 && { opacity: 0.3 }]} testID={`ing-down-${i}`}>
                  <Feather name="arrow-down" size={16} color={theme.color.onSurface} />
                </Pressable>
                <Pressable onPress={() => setEditing({ kind: 'ing', index: i, label: tCat(c), icon: c.icon || '' })}
                  style={styles.iconBtn} testID={`ing-edit-${i}`}>
                  <Feather name="edit-2" size={16} color={theme.color.onSurface} />
                </Pressable>
                <Pressable onPress={() => removeFromList(ingCats, setIngCats, i)} style={styles.iconBtn} testID={`ing-remove-${i}`}>
                  <Feather name="x" size={16} color={theme.color.error} />
                </Pressable>
              </View>
            </View>
          ))}
          <Pressable onPress={() => setEditing({ kind: 'ing', index: null, label: '', icon: '' })} style={styles.addBtn} testID="ing-add">
            <Feather name="plus" size={16} color={theme.color.brandPrimary} />
            <Text style={styles.addBtnTxt}>{t('prefs.addCategory')}</Text>
          </Pressable>
        </View>

        {/* --- Notifications (Pro) --- */}
        <View style={s.section}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={s.sectionH}>{t('notif.h')}</Text>
            {!isPro && (
              <View style={notifStyles.proBadge}>
                <Feather name="lock" size={9} color="#fff" />
                <Text style={notifStyles.proBadgeTxt}>PRO</Text>
              </View>
            )}
          </View>
          <Text style={s.sectionSub}>{t('notif.sub')}</Text>

          <View style={notifStyles.row}>
            <Text style={notifStyles.rowLabel}>{t('notif.enabled')}</Text>
            <Pressable
              onPress={() => {
                if (!isPro) { setUpsell(true); return; }
                Haptics.selectionAsync();
                setNotif(n => ({ ...n, enabled: !n.enabled }));
              }}
              style={[notifStyles.switch, notif.enabled && notifStyles.switchOn]}
              testID="notif-enabled"
            >
              <View style={[notifStyles.thumb, notif.enabled && notifStyles.thumbOn]} />
            </Pressable>
          </View>

          <View style={{ opacity: (notif.enabled && isPro) ? 1 : 0.45 }} pointerEvents={(notif.enabled && isPro) ? 'auto' : 'none'}>
            <Text style={notifStyles.subLabel}>{t('notif.expiryDays')}</Text>
            <View style={notifStyles.chipsRow}>
              {[0, 1, 2, 3, 7].map(d => {
                const active = notif.expiry_days_ahead === d;
                return (
                  <Pressable
                    key={d}
                    onPress={() => { Haptics.selectionAsync(); setNotif(n => ({ ...n, expiry_days_ahead: d })); }}
                    style={[notifStyles.chip, active && notifStyles.chipActive]}
                    testID={`notif-days-${d}`}
                  >
                    <Text style={[notifStyles.chipTxt, active && notifStyles.chipTxtActive]}>
                      {d === 0 ? t('common.today') : `${d}g`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={notifStyles.subLabel}>{t('notif.expiryTime')}</Text>
            <View style={notifStyles.chipsRow}>
              {[7, 9, 12, 18, 20].map(h => {
                const active = notif.notify_hour === h;
                return (
                  <Pressable
                    key={h}
                    onPress={() => { Haptics.selectionAsync(); setNotif(n => ({ ...n, notify_hour: h })); }}
                    style={[notifStyles.chip, active && notifStyles.chipActive]}
                    testID={`notif-hour-${h}`}
                  >
                    <Text style={[notifStyles.chipTxt, active && notifStyles.chipTxtActive]}>{h}:00</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={notifStyles.row}>
              <Text style={notifStyles.rowLabel}>{t('notif.freezer')}</Text>
              <Pressable
                onPress={() => { Haptics.selectionAsync(); setNotif(n => ({ ...n, freezer_enabled: !n.freezer_enabled })); }}
                style={[notifStyles.switch, notif.freezer_enabled && notifStyles.switchOn]}
                testID="notif-freezer"
              >
                <View style={[notifStyles.thumb, notif.freezer_enabled && notifStyles.thumbOn]} />
              </Pressable>
            </View>
          </View>

          {Platform.OS === 'web' && notif.enabled && (
            <View style={notifStyles.warn}>
              <Feather name="info" size={12} color={theme.color.brand} />
              <Text style={notifStyles.warnTxt}>{t('notif.nativeOnly')}</Text>
            </View>
          )}
        </View>

        {msg ? (
          <View style={[s.msgBox, msg.kind === 'err' ? s.msgErr : s.msgOk]} testID="prefs-msg">
            <Feather name={msg.kind === 'err' ? 'alert-circle' : 'check-circle'} size={16}
              color={msg.kind === 'err' ? theme.color.error : theme.color.success} />
            <Text style={[s.msgTxt, { color: msg.kind === 'err' ? theme.color.error : theme.color.success }]}>{msg.text}</Text>
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      {/* Edit modal (courses + ing cats) */}
      <Modal transparent visible={!!editing} animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={s.overlay}>
          <View style={s.modalCard} testID="cat-modal">
            <Text style={s.modalH}>
              {editing?.index === null ? t('prefs.newCategory') : t('prefs.renameCategory')}
            </Text>
            <Text style={s.modalP}>
              {editing?.kind === 'course' ? t('prefs.courseExamplePh') : t('prefs.ingExamplePh')}
            </Text>
            <View style={{ height: theme.spacing.md }} />
            <TextInput
              testID="cat-modal-input"
              placeholder={t('common.name')}
              placeholderTextColor={theme.color.onSurfaceTertiary}
              value={editing?.label || ''}
              onChangeText={(text) => setEditing(prev => (prev ? { ...prev, label: text } : prev))}
              autoFocus maxLength={40} style={s.input}
              onSubmitEditing={commitEdit} returnKeyType="done"
            />
            {editing?.kind === 'ing' && (
              <>
                <Text style={{ fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 8, marginBottom: 4 }}>{t('prefs.icon.h')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {EMOJI_SUGGESTIONS.map(e => (
                    <Pressable
                      key={e}
                      onPress={() => setEditing(prev => (prev && prev.kind === 'ing' ? { ...prev, icon: e } : prev))}
                      style={[
                        styles.emojiBtn,
                        editing.icon === e && { borderColor: theme.color.brandPrimary, backgroundColor: theme.color.brandTertiary },
                      ]}
                      testID={`emoji-${e}`}
                    >
                      <Text style={{ fontSize: 20 }}>{e}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
              <Pressable onPress={() => setEditing(null)} style={s.btnGhost} testID="cat-cancel">
                <Text style={s.btnGhostTxt}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable onPress={commitEdit} style={s.btnPrim} testID="cat-save">
                <Text style={s.btnDangerTxt}>{editing?.index === null ? t('common.add') : t('common.save')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <ProUpsellModal open={upsell} onClose={() => setUpsell(false)} feature="notifications" />
    </SafeAreaView>
  );
}

const notifStyles = StyleSheet.create({
  proBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: theme.color.brand },
  proBadgeTxt: { color: '#fff', fontWeight: '700', fontSize: 9 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.sm },
  rowLabel: { fontSize: 14, color: theme.color.onSurface, flex: 1 },
  subLabel: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.md, marginBottom: 6, fontWeight: '500' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border },
  chipActive: { backgroundColor: theme.color.brandTertiary, borderColor: theme.color.brandPrimary },
  chipTxt: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  chipTxtActive: { color: theme.color.brandPrimary, fontWeight: '600' },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: theme.color.borderStrong, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: theme.color.brandPrimary },
  thumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  thumbOn: { alignSelf: 'flex-end' },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: theme.spacing.sm, padding: 10, backgroundColor: '#FDE2CE', borderRadius: theme.radius.md },
  warnTxt: { flex: 1, fontSize: 11, color: theme.color.brand, fontStyle: 'italic' },
});

const styles = StyleSheet.create({
  saveHeader: { minWidth: 60, height: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
  saveHeaderTxt: { color: theme.color.brandPrimary, fontWeight: '600', fontSize: 15 },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: theme.spacing.sm },
  dayChip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
  },
  dayChipActive: { backgroundColor: theme.color.brandTertiary, borderColor: theme.color.brandPrimary },
  dayChipTxt: { fontSize: 14, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  dayChipTxtActive: { color: theme.color.brandPrimary, fontWeight: '600' },
  spanRow: { flexDirection: 'row', gap: 10, marginTop: theme.spacing.sm },
  spanCard: {
    flex: 1, padding: theme.spacing.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surface,
    alignItems: 'flex-start', gap: 6,
  },
  spanCardActive: { borderColor: theme.color.brandPrimary, borderWidth: 2, backgroundColor: theme.color.brandTertiary },
  spanIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: theme.color.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  spanLabel: { fontSize: 14, color: theme.color.onSurface, fontWeight: '600' },
  spanSub: { fontSize: 11, color: theme.color.onSurfaceTertiary },
  courseRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    backgroundColor: theme.color.surface, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border,
    paddingVertical: 8, paddingLeft: 12, paddingRight: 4, marginBottom: 8,
  },
  courseIcon: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  courseLabel: { flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: '500' },
  courseActions: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, marginTop: theme.spacing.sm,
    borderRadius: theme.radius.pill, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.brandPrimary,
  },
  addBtnTxt: { color: theme.color.brandPrimary, fontWeight: '600', fontSize: 14 },
  emojiBtn: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },
});
