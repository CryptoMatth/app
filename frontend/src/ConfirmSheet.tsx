/**
 * Styled confirmation sheet — replaces the OS-ugly `Alert.alert()` for
 * destructive actions. Full-width bottom-sheet with icon, title, body and
 * two actions. Matches the Planibble brand (teal theme, cream card).
 *
 * Design notes (lessons learned Oct 2026):
 *   - Uses Modal's built-in `animationType="fade"` instead of a custom
 *     Animated.Value slide. The custom animation + nested Pressables was
 *     causing the sheet to get stuck open on native Android (B1 regression).
 *   - All inner buttons use plain Pressable with explicit onPress — no
 *     bubbling conflicts with the backdrop Pressable since they are
 *     siblings, not nested inside each other.
 *   - `handleConfirm` closes the modal FIRST, then runs the async action.
 *     This guarantees the UI never gets stuck even if the action throws.
 *
 * Usage:
 *   const [confirm, setConfirm] = useState<ConfirmState | null>(null);
 *   setConfirm({ id, name });
 *   <ConfirmSheet
 *      visible={!!confirm}
 *      title="Rimuovere?"
 *      body={`«${confirm?.name}» verrà eliminato.`}
 *      confirmLabel="Elimina"
 *      tone="danger"
 *      onConfirm={async () => { await api.deleteFridge(confirm!.id); }}
 *      onClose={() => setConfirm(null)}
 *   />
 */
import { View, Text, StyleSheet, Pressable, Modal, Platform } from 'react-native';
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

export function ConfirmSheet({
  visible, title, body, icon, tone = 'danger', confirmLabel,
  cancelLabel, onConfirm, onClose, testID,
}: ConfirmSheetProps) {
  const confirmColor = {
    danger: theme.color.error,
    brand: theme.color.brandPrimary,
    neutral: theme.color.onSurfaceSecondary,
  }[tone];
  const iconBg = {
    danger: '#FADAD4',  // soft red-tinted fill that works with the Planibble palette
    brand: theme.color.brandTertiary,
    neutral: theme.color.surfaceSecondary,
  }[tone];
  const resolvedIcon = icon ?? (tone === 'danger' ? 'trash-2' : tone === 'brand' ? 'check-circle' : 'info');

  const handleConfirm = () => {
    // Fire haptic BEFORE closing — once the Modal is unmounted RN may
    // disallow Haptics on some devices.
    try { Haptics.notificationAsync(tone === 'danger' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success); } catch {}
    // Close the modal FIRST so UI never gets stuck if the async action throws.
    onClose();
    // Fire the action after a microtask so React has a chance to unmount the
    // Modal before any re-render triggered by setState inside `onConfirm`.
    Promise.resolve().then(async () => {
      try { await onConfirm(); } catch (err) {
        if (__DEV__) console.warn('[ConfirmSheet] onConfirm failed', err);
      }
    });
  };

  const handleCancel = () => {
    try { Haptics.selectionAsync(); } catch {}
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      hardwareAccelerated
      statusBarTranslucent
    >
      <View style={styles.container}>
        {/* Backdrop — tapping outside the sheet cancels. */}
        <Pressable
          style={styles.backdrop}
          onPress={handleCancel}
          testID={testID ? `${testID}-backdrop` : undefined}
        />

        {/* Sheet — bottom-anchored. */}
        <SafeAreaView edges={['bottom']} style={styles.safe} pointerEvents="box-none">
          <View style={styles.sheet} testID={testID}>
            <View style={styles.handle} />
            <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
              <Feather name={resolvedIcon} size={26} color={confirmColor} />
            </View>
            <Text style={styles.title}>{title}</Text>
            {body ? <Text style={styles.body}>{body}</Text> : null}
            <View style={styles.btnRow}>
              <Pressable
                onPress={handleCancel}
                style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.pressed]}
                testID={testID ? `${testID}-cancel` : undefined}
              >
                <Text style={styles.btnSecondaryTxt}>{cancelLabel || 'Annulla'}</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirm}
                style={({ pressed }) => [styles.btn, { backgroundColor: confirmColor }, pressed && styles.pressed]}
                testID={testID ? `${testID}-confirm` : undefined}
              >
                <Text style={styles.btnPrimaryTxt}>{confirmLabel}</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16, 35, 40, 0.45)',
  },
  safe: {
    backgroundColor: 'transparent',
  },
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
  pressed: { opacity: 0.75 },
});
