import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { useTranslation } from '@/src/i18n';

type Ingredient = {
  name: string;
  quantity: number;
  unit: string;
  category_id?: string;
};
type DishSuggestion = {
  name: string;
  course: string;
  servings: number;
  ingredients: Ingredient[];
  preparation: string;
  notes: string;
};

export default function AiSuggestScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { prefs } = useAuth();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dishes, setDishes] = useState<DishSuggestion[]>([]);
  const [savedIndexes, setSavedIndexes] = useState<Set<number>>(new Set());
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));

  const catById = useMemo(() => {
    const m: Record<string, any> = {};
    (prefs?.ingredient_categories || []).forEach((c: any) => { m[c.id] = c; });
    return m;
  }, [prefs]);

  const courseLabel = useCallback((cid: string) => {
    const c = (prefs?.courses || []).find((x: any) => x.id === cid);
    return c?.label || cid;
  }, [prefs]);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSavedIndexes(new Set());
    try {
      const res = await api.aiSuggestDishes({ count: 4 });
      setDishes(res.dishes as DishSuggestion[]);
      setExpanded(new Set([0]));
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('empty_fridge')) {
        setError('empty_fridge');
      } else {
        setError('ai_error');
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { generate(); }, [generate]);

  const toggleExpand = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
    Haptics.selectionAsync();
  };

  const saveDish = async (i: number, d: DishSuggestion) => {
    if (savedIndexes.has(i) || savingIndex !== null) return;
    setSavingIndex(i);
    try {
      await api.createDish({
        name: d.name,
        course: d.course,
        servings: d.servings,
        ingredients: d.ingredients,
        preparation: d.preparation,
        notes: d.notes,
      });
      setSavedIndexes(prev => new Set(prev).add(i));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Errore', e?.message || 'Errore salvataggio');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    setSavingIndex(null);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="ai-suggest-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="ai-back">
          <Feather name="chevron-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1} numberOfLines={1}>{t('ai.title')}</Text>
          <Text style={styles.sub} numberOfLines={1}>{t('ai.subtitle')}</Text>
        </View>
        <Pressable
          onPress={generate}
          style={[styles.iconBtn, loading && { opacity: 0.5 }]}
          disabled={loading}
          testID="ai-regenerate"
        >
          {loading ? (
            <ActivityIndicator size="small" color={theme.color.onSurface} />
          ) : (
            <Feather name="refresh-cw" size={17} color={theme.color.onSurface} />
          )}
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <View style={styles.sparkleWrap}>
            <Feather name="star" size={28} color={theme.color.brand} />
          </View>
          <ActivityIndicator color={theme.color.brandPrimary} style={{ marginTop: 16 }} />
          <Text style={styles.loadingTxt}>{t('ai.loading')}</Text>
        </View>
      ) : error === 'empty_fridge' ? (
        <View style={styles.center}>
          <Feather name="package" size={44} color={theme.color.borderStrong} />
          <Text style={styles.errH}>{t('ai.emptyFridge')}</Text>
          <Pressable style={styles.primaryBtn} onPress={() => router.back()}>
            <Feather name="chevron-left" size={16} color="#fff" />
            <Text style={styles.primaryBtnTxt}>{t('common.back')}</Text>
          </Pressable>
        </View>
      ) : error === 'ai_error' ? (
        <View style={styles.center}>
          <Feather name="alert-triangle" size={44} color={theme.color.warning} />
          <Text style={styles.errH}>{t('ai.error')}</Text>
          <Pressable style={styles.primaryBtn} onPress={generate}>
            <Feather name="refresh-cw" size={16} color="#fff" />
            <Text style={styles.primaryBtnTxt}>{t('ai.regenerate')}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 + insets.bottom }}
          showsVerticalScrollIndicator={false}
        >
          {dishes.map((d, i) => {
            const isOpen = expanded.has(i);
            const isSaved = savedIndexes.has(i);
            const isSaving = savingIndex === i;
            return (
              <View key={`${d.name}-${i}`} style={styles.card} testID={`ai-dish-${i}`}>
                <Pressable onPress={() => toggleExpand(i)} style={styles.cardHead}>
                  <View style={styles.iconBox}>
                    <Feather name="coffee" size={20} color={theme.color.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dishName}>{d.name}</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <View style={styles.chip}>
                        <Text style={styles.chipTxt}>{courseLabel(d.course)}</Text>
                      </View>
                      <View style={styles.chip}>
                        <Feather name="users" size={10} color={theme.color.onSurfaceSecondary} />
                        <Text style={styles.chipTxt}>
                          {d.servings === 1 ? t('ai.serving1') : t('ai.servings', { n: d.servings })}
                        </Text>
                      </View>
                      <View style={styles.chip}>
                        <Feather name="list" size={10} color={theme.color.onSurfaceSecondary} />
                        <Text style={styles.chipTxt}>{d.ingredients.length}</Text>
                      </View>
                    </View>
                  </View>
                  <Feather
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={theme.color.onSurfaceSecondary}
                  />
                </Pressable>

                {isOpen && (
                  <View style={styles.cardBody}>
                    <Text style={styles.sectionH}>{t('ai.ingredients')}</Text>
                    <View style={{ marginTop: 6 }}>
                      {d.ingredients.map((ing, j) => {
                        const cat = catById[ing.category_id || 'altro'];
                        return (
                          <View key={j} style={styles.ingRow}>
                            <Text style={styles.ingIcon}>{cat?.icon || '📦'}</Text>
                            <Text style={styles.ingName}>{ing.name}</Text>
                            <Text style={styles.ingQty}>
                              {ing.quantity > 0 ? `${ing.quantity} ${ing.unit}` : ing.unit}
                            </Text>
                          </View>
                        );
                      })}
                    </View>

                    {!!d.preparation && (
                      <>
                        <Text style={[styles.sectionH, { marginTop: 14 }]}>{t('ai.steps')}</Text>
                        <Text style={styles.prep}>{d.preparation}</Text>
                      </>
                    )}

                    {!!d.notes && (
                      <View style={styles.noteBox}>
                        <Feather name="info" size={12} color={theme.color.brandSecondary} />
                        <Text style={styles.noteTxt}>{d.notes}</Text>
                      </View>
                    )}

                    <Pressable
                      onPress={() => saveDish(i, d)}
                      style={[styles.saveBtn, (isSaved || isSaving) && styles.saveBtnDone]}
                      disabled={isSaved || isSaving}
                      testID={`ai-save-${i}`}
                    >
                      {isSaving ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : isSaved ? (
                        <>
                          <Feather name="check" size={16} color="#fff" />
                          <Text style={styles.saveBtnTxt}>{t('ai.saved')}</Text>
                        </>
                      ) : (
                        <>
                          <Feather name="bookmark" size={16} color="#fff" />
                          <Text style={styles.saveBtnTxt}>{t('ai.save')}</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}

          <Text style={styles.disclaimer}>{t('ai.disclaimer')}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.md,
    borderBottomWidth: 1, borderBottomColor: theme.color.divider, gap: 8,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  h1: { fontFamily: theme.font.display, fontSize: 20, color: theme.color.onSurface },
  sub: { fontSize: 11, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl, gap: 12 },
  sparkleWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F5E8D8', alignItems: 'center', justifyContent: 'center' },
  loadingTxt: { fontSize: 13, color: theme.color.onSurfaceSecondary, textAlign: 'center', marginTop: 8 },
  errH: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface, marginTop: 12, textAlign: 'center', maxWidth: 300 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.color.brand, paddingHorizontal: 20, paddingVertical: 12, borderRadius: theme.radius.pill, marginTop: 12 },
  primaryBtnTxt: { color: '#fff', fontWeight: '600' },

  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    marginBottom: 12,
    overflow: 'hidden',
  },
  cardHead: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12,
  },
  iconBox: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5E8D8',
    alignItems: 'center', justifyContent: 'center',
  },
  dishName: { fontFamily: theme.font.display, fontSize: 16, color: theme.color.onSurface },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: theme.color.surfaceSecondary,
    borderRadius: 8,
  },
  chipTxt: { fontSize: 11, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  cardBody: {
    padding: 12,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: theme.color.divider,
    marginTop: 4,
  },
  sectionH: { fontSize: 11, fontWeight: '700', color: theme.color.onSurfaceTertiary, letterSpacing: 0.6 },
  ingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 4,
  },
  ingIcon: { fontSize: 14, width: 20 },
  ingName: { flex: 1, fontSize: 13, color: theme.color.onSurface },
  ingQty: { fontSize: 12, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  prep: {
    fontSize: 13, color: theme.color.onSurface, marginTop: 6, lineHeight: 20,
  },
  noteBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginTop: 10, padding: 10, borderRadius: theme.radius.sm,
    backgroundColor: '#E5EDDF',
  },
  noteTxt: { flex: 1, fontSize: 12, color: theme.color.brandSecondary, lineHeight: 17 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 14, paddingVertical: 12,
    backgroundColor: theme.color.brand,
    borderRadius: theme.radius.pill,
  },
  saveBtnDone: { backgroundColor: theme.color.success },
  saveBtnTxt: { color: '#fff', fontWeight: '600', fontSize: 14 },
  disclaimer: {
    fontSize: 11, color: theme.color.onSurfaceTertiary, fontStyle: 'italic',
    textAlign: 'center', marginTop: 8, marginBottom: 12, paddingHorizontal: 20,
  },
});
