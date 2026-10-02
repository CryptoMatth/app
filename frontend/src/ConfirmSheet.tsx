/**
 * Styled confirmation sheet — replaces the OS-ugly `Alert.alert()` for
 * destructive actions. Full-width bottom-sheet with icon, title, body and
 * two actions. Matches the Planibble brand (teal theme, cream card).
 *
 * Usage:
 *   const [confirm, setConfirm] = useState<ConfirmSheetProps | null>(null);
 *   // on tap:
 *   setConfirm({
 *     title: 'Rimuovere l\'ingrediente?',
 *     body: 'Verrà eliminato definitivamente dalla Dispensa.',
 *     confirmLabel: 'Elimina',
 *     tone: 'danger',
 *     onConfirm: async () => { await api.deleteFridge(id); },
 *   });
 *   // in render: <ConfirmSheet {...confirm} onClose={() => setConfirm(null)} />
 */
import { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Modal, Animated, Easing,
  Platform, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import * as Haptics from 'expo-haptics';
import { theme } from '@/src/theme';

export type ConfirmSheetTone = 'danger' | 'brand' | 'neutral';

export type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  body?: string;
  icon?: any; // Feather icon name
  tone?: ConfirmSheetTone;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  testID?: string;
};

const H = Dimensions.get('window').height;

export function ConfirmSheet({
  visible, title, body, icon, tone = 'danger', confirmLabel,
  cancelLabel, onConfirm, onClose, testID,
}: ConfirmSheetProps) {
  const slide = useRef(new Animated.Value(1)).current; // 1 = hidden, 0 = shown

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 0 : 1,
      duration: 220,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [0, 420] });
  const overlayOpacity = slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  const confirmColor = {
    danger: theme.color.error,
    brand: theme.color.brandPrimary,
    neutral: theme.color.onSurfaceSecondary,
  }[tone];
  const iconBg = {
    danger: '#F5E0DC',
    brand: theme.color.brandTertiary,
    neutral: theme.color.surfaceSecondary,
  }[tone];
  const resolvedIcon = icon ?? (tone === 'danger' ? 'trash-2' : tone === 'brand' ? 'check-circle' : 'info');

  const handleConfirm = async () => {
    try { Haptics.notificationAsync(tone === 'danger' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success); } catch {}
    try { await onConfirm(); } finally { onClose(); }
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFillObject}>
        {/* Dimmed backdrop */}
        <Animated.View style={[styles.backdrop, { opacity: overlayOpacity }]}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} testID={testID ? `${testID}-backdrop` : undefined} />
        </Animated.View>

        {/* Sheet */}
        <Animated.View style={[styles.sheetWrap, { transform: [{ translateY }] }]} pointerEvents="box-none">
          <SafeAreaView edges={['bottom']} style={styles.safe}>
            <View style={styles.sheet} testID={testID}>
              <View style={styles.handle} />
              <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
                <Feather name={resolvedIcon} size={26} color={confirmColor} />
              </View>
              <Text style={styles.title}>{title}</Text>
              {body ? <Text style={styles.body}>{body}</Text> : null}
              <View style={styles.btnRow}>
                <Pressable
                  onPress={onClose}
                  style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && { opacity: 0.7 }]}
                  testID={testID ? `${testID}-cancel` : undefined}
                >
                  <Text style={styles.btnSecondaryTxt}>{cancelLabel || 'Annulla'}</Text>
                </Pressable>
                <Pressable
                  onPress={handleConfirm}
                  style={({ pressed }) => [styles.btn, { backgroundColor: confirmColor }, pressed && { opacity: 0.85 }]}
                  testID={testID ? `${testID}-confirm` : undefined}
                >
                  <Text style={styles.btnPrimaryTxt}>{confirmLabel}</Text>
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16, 35, 40, 0.45)',
  },
  sheetWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
  },
  safe: { backgroundColor: 'transparent' },
  sheet: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: 10,
    paddingBottom: theme.spacing.lg,
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 10 },
      android: { elevation: 20 },
    }),
  },
  handle: {
    width: 44, height: 4, borderRadius: 2,
    backgroundColor: theme.color.borderStrong, opacity: 0.5,
    marginBottom: theme.spacing.lg,
  },
  iconCircle: {
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  title: {
    fontFamily: theme.font.display, fontSize: 20,
    color: theme.color.onSurface, textAlign: 'center',
    marginBottom: 6,
  },
  body: {
    fontSize: 14, color: theme.color.onSurfaceSecondary,
    textAlign: 'center', lineHeight: 20,
    marginBottom: theme.spacing.lg,
    paddingHorizontal: 10,
  },
  btnRow: {
    flexDirection: 'row', alignSelf: 'stretch',
    gap: theme.spacing.sm, marginTop: 4,
  },
  btn: {
    flex: 1, height: 50, borderRadius: theme.radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  btnSecondary: {
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
  },
  btnSecondaryTxt: { color: theme.color.onSurface, fontWeight: '600', fontSize: 15 },
  btnPrimaryTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
