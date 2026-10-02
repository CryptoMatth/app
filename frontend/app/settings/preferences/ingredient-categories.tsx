import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import { useAuth, IngredientCategory } from '@/src/auth';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { useTranslation } from '@/src/i18n';
import { PrefsScreenShell } from '@/src/PrefsScreenShell';
import { CategoryListEditor } from '@/src/CategoryListEditor';
import { useHasTier, ProUpsellModal } from '@/src/ProGate';

const EMOJI = [
  // Cibo — freschi
  '🥬', '🍎', '🍌', '🥕', '🌶️', '🌰', '🫒', '🥑', '🥦', '🍅',
  // Cibo — proteine
  '🥩', '🐟', '🦐', '🥚', '🧀', '🥓',
  // Cibo — dispensa, farinacei, conserve
  '🍞', '🥨', '🥐', '🥖', '🫓', '🥯', '🌾', '🌽', '🥔', '🍚', '🍝', '🧂', '🫙', '🥫', '🍯',
  // Oli, condimenti e spezie
  '🫒', '🧈', '🌶️', '🧄', '🧅', '🥥',
  // Legumi
  '🫘',
  // Snack e frutta secca
  '🥜', '🍿', '🥨', '🍟',
  // Cibo — surgelati e freddi
  '❄️', '🍦', '🥶',
  // Cibo — snack e dolci
  '🍫', '🍪', '🧁', '🍰', '🍩', '🍬',
  // Bevande
  '🥤', '☕', '🍵', '🍷', '🍺', '🧃', '💧',
  // Pulizia casa
  '🧽', '🧴', '🧼', '🧹', '🧺', '🪣',
  // Igiene personale
  '🧻', '🪒', '🪥', '💄',
  // Farmaci e cura
  '💊', '🩹', '🌡️', '🌿',
  // Bambini
  '🍼', '👶',
  // Animali
  '🐾', '🐕', '🐈',
  // Casa e vari
  '🕯️', '🔋', '💡', '📦', '🎁',
];

export default function IngredientCategoriesPreference() {
  const { t, tCat } = useTranslation();
  const { prefs, updatePreferences } = useAuth();
  const isProPlus = useHasTier('pro_plus');
  const [upsell, setUpsell] = useState(false);
  const [ingCats, setIngCats] = useState<IngredientCategory[]>(prefs.ingredient_categories);
  useEffect(() => setIngCats(prefs.ingredient_categories), [prefs.ingredient_categories]);

  const dirty = JSON.stringify(ingCats.map(c => ({
    id: c.id || '', label: c.label, icon: c.icon || null, color: c.color || null,
  }))) !== JSON.stringify((prefs.ingredient_categories || []).map(c => ({
    id: c.id || '', label: c.label, icon: c.icon || null, color: c.color || null,
  })));

  return (
    <PrefsScreenShell
      title={t('prefs.ingCats.h')}
      dirty={isProPlus && dirty}
      onSave={() => updatePreferences({ ingredient_categories: ingCats })}
      testID="prefs-ing-cats"
    >
      <View style={s.section}>
        <Text style={s.sectionSub}>{t('prefs.ingCats.sub')}</Text>
        {!isProPlus ? (
          <Pressable onPress={() => setUpsell(true)} style={styles.lockedRow} testID="ing-cats-locked">
            <Feather name="lock" size={16} color={theme.color.brand} />
            <Text style={styles.lockedTxt}>{t('prefs.ingCats.lockedBody')}</Text>
            <Feather name="chevron-right" size={16} color={theme.color.onSurfaceTertiary} />
          </Pressable>
        ) : (
          <CategoryListEditor
            items={ingCats}
            setItems={(next) => setIngCats(next as IngredientCategory[])}
            emojiCatalog={EMOJI}
            labelResolver={(c) => tCat(c as IngredientCategory)}
            addLabel={t('prefs.addCategory')}
            newTitle={t('prefs.newCategory')}
            renameTitle={t('prefs.renameCategory')}
            examplePh={t('prefs.ingExamplePh')}
            testPrefix="ing"
          />
        )}
      </View>
      <ProUpsellModal open={upsell} onClose={() => setUpsell(false)} feature="ingredient_categories" />
    </PrefsScreenShell>
  );
}

const styles = StyleSheet.create({
  lockedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border, borderStyle: 'dashed',
    backgroundColor: theme.color.surfaceSecondary,
  },
  lockedTxt: {
    flex: 1, fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 17,
  },
});
