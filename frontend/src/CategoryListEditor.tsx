/**
 * Reusable list editor for Course + IngredientCategory prefs.
 * Handles reorder, rename, add, delete with an emoji-icon picker modal.
 * Parent owns the array state and passes callbacks.
 */
import { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Modal, TextInput, Alert, ScrollView,
} from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import * as Haptics from 'expo-haptics';
import { theme } from './theme';
import { settingsStyles as s } from './settingsStyles';
import { useTranslation } from './i18n';

export type CategoryLike = {
  id?: string;
  label: string;
  icon?: string | null;
  color?: string | null;
};

type Props<T extends CategoryLike> = {
  items: T[];
  setItems: (next: T[]) => void;
  emojiCatalog: string[];
  labelResolver?: (item: T) => string; // for translated defaults
  addLabel: string;
  newTitle: string;
  renameTitle: string;
  examplePh: string;
  testPrefix: string;
};

export function CategoryListEditor<T extends CategoryLike>({
  items, setItems, emojiCatalog, labelResolver, addLabel, newTitle, renameTitle, examplePh, testPrefix,
}: Props<T>) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<{ index: number | null; label: string; icon: string } | null>(null);

  const moveInList = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    Haptics.selectionAsync();
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };

  const removeFromList = (i: number) => {
    if (items.length <= 1) { Alert.alert('!', t('prefs.errors.minOne')); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setItems(items.filter((_, idx) => idx !== i));
  };

  const commitEdit = () => {
    if (!editing) return;
    const label = editing.label.trim();
    if (!label) return;
    if (label.length > 40) { Alert.alert('!', t('prefs.errors.tooMany')); return; }
    const dupIdx = items.findIndex((c, idx) =>
      c.label.trim().toLowerCase() === label.toLowerCase() && idx !== editing.index,
    );
    if (dupIdx !== -1) { Alert.alert('!', t('prefs.errors.duplicate')); return; }
    Haptics.selectionAsync();
    const icon = (editing.icon || '').trim().slice(0, 4) || null;
    if (editing.index === null) {
      setItems([...items, { id: '', label, icon, color: null } as unknown as T]);
    } else {
      setItems(items.map((c, i) => i === editing.index ? ({ ...c, label, icon } as T) : c));
    }
    setEditing(null);
  };

  return (
    <View>
      {items.map((c, i) => {
        const displayLabel = labelResolver ? labelResolver(c) : c.label;
        return (
          <View key={`${testPrefix}_${c.id || 'new'}_${i}`} style={styles.row} testID={`${testPrefix}-row-${i}`}>
            <View style={[styles.icon, { backgroundColor: c.color || theme.color.brandTertiary }]}>
              <Text style={{ fontSize: 16 }}>{c.icon || '📦'}</Text>
            </View>
            <Text style={styles.label} numberOfLines={1}>{displayLabel}</Text>
            <View style={styles.actions}>
              <Pressable onPress={() => moveInList(i, -1)} disabled={i === 0}
                style={[styles.iconBtn, i === 0 && { opacity: 0.3 }]} testID={`${testPrefix}-up-${i}`}>
                <Feather name="arrow-up" size={16} color={theme.color.onSurface} />
              </Pressable>
              <Pressable onPress={() => moveInList(i, 1)} disabled={i === items.length - 1}
                style={[styles.iconBtn, i === items.length - 1 && { opacity: 0.3 }]} testID={`${testPrefix}-down-${i}`}>
                <Feather name="arrow-down" size={16} color={theme.color.onSurface} />
              </Pressable>
              <Pressable onPress={() => setEditing({ index: i, label: displayLabel, icon: c.icon || '' })}
                style={styles.iconBtn} testID={`${testPrefix}-edit-${i}`}>
                <Feather name="edit-2" size={16} color={theme.color.onSurface} />
              </Pressable>
              <Pressable onPress={() => removeFromList(i)} style={styles.iconBtn} testID={`${testPrefix}-remove-${i}`}>
                <Feather name="x" size={16} color={theme.color.error} />
              </Pressable>
            </View>
          </View>
        );
      })}
      <Pressable
        onPress={() => setEditing({ index: null, label: '', icon: '' })}
        style={styles.addBtn}
        testID={`${testPrefix}-add`}
      >
        <Feather name="plus" size={16} color={theme.color.brandPrimary} />
        <Text style={styles.addBtnTxt}>{addLabel}</Text>
      </Pressable>

      <Modal transparent visible={!!editing} animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={s.overlay}>
          <View style={s.modalCard} testID="cat-modal">
            <Text style={s.modalH}>{editing?.index === null ? newTitle : renameTitle}</Text>
            <Text style={s.modalP}>{examplePh}</Text>
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
            <Text style={{ fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 8, marginBottom: 4 }}>{t('prefs.icon.h')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {emojiCatalog.map(e => (
                <Pressable
                  key={e}
                  onPress={() => setEditing(prev => (prev ? { ...prev, icon: e } : prev))}
                  style={[
                    styles.emojiBtn,
                    editing?.icon === e && { borderColor: theme.color.brandPrimary, backgroundColor: theme.color.brandTertiary },
                  ]}
                  testID={`emoji-${e}`}
                >
                  <Text style={{ fontSize: 20 }}>{e}</Text>
                </Pressable>
              ))}
            </ScrollView>
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
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
    backgroundColor: theme.color.surface, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border,
    paddingVertical: 8, paddingLeft: 12, paddingRight: 4, marginBottom: 8,
  },
  icon: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: '500' },
  actions: { flexDirection: 'row', alignItems: 'center' },
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
