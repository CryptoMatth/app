/**
 * Cross-platform photo picker + uploader.
 *
 * - Opens the native image picker (or requests camera roll permission)
 * - Compresses/resizes via `expo-image-picker`
 * - Uploads to /api/upload/photo as multipart/form-data (Pro-only endpoint)
 * - Returns the storage `path` string persisted on the parent record
 *
 * Web quirk: FormData on RN Web needs a real Blob (not `{uri, name, type}`).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Image, Pressable, ActivityIndicator, StyleSheet, Alert, Platform, Linking, Modal, Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Feather from '@react-native-vector-icons/feather';
import { theme } from './theme';
import { api } from './api';
import { useAuth } from './auth';
import { useTranslation } from './i18n';
import { useIsPro, ProUpsellModal } from './ProGate';

type Props = {
  value?: string | null;               // storage path
  onChange: (path: string | null) => void;
  size?: number;
  rounded?: boolean;
  testID?: string;
};

/** Resolve a storage `path` (as returned by /api/upload/photo) to a URL suitable for <Image>.
 *  Native: uses backend URL + Authorization header (returned separately).
 *  Web:    uses signed short-lived query token.
 */
export function usePhotoUrl(path?: string | null): { uri?: string; headers?: Record<string, string> } {
  const { token } = useAuth();
  const [signed, setSigned] = useState<string | null>(null);

  useEffect(() => {
    if (!path || Platform.OS !== 'web') return;
    let cancelled = false;
    (async () => {
      try {
        const t = await api.signPhotoToken(path);
        if (!cancelled) setSigned(t);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [path]);

  if (!path) return {};
  const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
  if (Platform.OS === 'web') {
    if (!signed) return {};
    return { uri: `${base}/api/files/${encodeURI(path)}?token=${encodeURIComponent(signed)}` };
  }
  return {
    uri: `${base}/api/files/${encodeURI(path)}`,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  };
}

/** Small square photo preview + camera/remove buttons. */
export function PhotoPicker({ value, onChange, size = 96, rounded, testID }: Props) {
  const { t } = useTranslation();
  const isPro = useIsPro();
  const [busy, setBusy] = useState(false);
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const { uri, headers } = usePhotoUrl(value);

  const pick = useCallback(async () => {
    if (!isPro) { setUpsellOpen(true); return; }
    // Ask for permission with in-context explainer
    const { status, canAskAgain } = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (req.status !== 'granted') {
        if (!canAskAgain) {
          Alert.alert(
            t('photo.permTitle'),
            t('photo.permBody'),
            [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('photo.openSettings'), onPress: () => Linking.openSettings() },
            ],
          );
        }
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];

    setBusy(true);
    try {
      const path = await api.uploadPhoto(asset.uri, asset.mimeType || 'image/jpeg');
      onChange(path);
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }, [isPro, onChange, t]);

  const remove = useCallback(() => {
    onChange(null);
    setLightboxOpen(false);
  }, [onChange]);

  const onThumbPress = useCallback(() => {
    // With no photo yet → open picker (existing behavior).
    // With photo present → open lightbox so users can inspect / replace / remove.
    if (!value) { pick(); return; }
    setLightboxOpen(true);
  }, [value, pick]);

  const borderRadius = rounded ? size / 2 : theme.radius.md;
  const win = Dimensions.get('window');
  const boxSize = Math.min(win.width, win.height) * 0.86;

  return (
    <View style={{ alignItems: 'center' }}>
      <Pressable
        onPress={onThumbPress}
        disabled={busy}
        style={[
          styles.wrap,
          { width: size, height: size, borderRadius },
          !value && styles.wrapEmpty,
        ]}
        testID={testID}
      >
        {uri ? (
          <Image
            source={{ uri, headers }}
            style={{ width: size, height: size, borderRadius }}
            resizeMode="cover"
          />
        ) : (
          <Feather name="camera" size={Math.max(18, size / 3.5)} color={theme.color.onSurfaceTertiary} />
        )}
        {busy && (
          <View style={[styles.busy, { borderRadius }]}>
            <ActivityIndicator color="#fff" />
          </View>
        )}
        {!isPro && (
          <View style={styles.proBadge}>
            <Feather name="lock" size={9} color="#fff" />
            <Text style={styles.proBadgeTxt}>PRO</Text>
          </View>
        )}
      </Pressable>
      {value ? (
        <Pressable onPress={remove} style={styles.remove} testID={`${testID}-remove`}>
          <Feather name="trash-2" size={12} color={theme.color.error} />
          <Text style={styles.removeTxt}>{t('common.remove')}</Text>
        </Pressable>
      ) : null}
      <ProUpsellModal open={upsellOpen} onClose={() => setUpsellOpen(false)} feature="photos" />

      {/* Lightbox */}
      <Modal
        visible={lightboxOpen && !!uri}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxOpen(false)}
      >
        <Pressable style={lbStyles.overlay} onPress={() => setLightboxOpen(false)}>
          <Pressable onPress={e => e.stopPropagation?.()} style={lbStyles.card}>
            <Pressable style={lbStyles.closeBtn} onPress={() => setLightboxOpen(false)} testID={`${testID}-lightbox-close`}>
              <Feather name="x" size={22} color="#fff" />
            </Pressable>
            {uri ? (
              <Image
                source={{ uri, headers }}
                style={{ width: boxSize, height: boxSize, borderRadius: theme.radius.lg }}
                resizeMode="contain"
              />
            ) : null}
            <View style={lbStyles.actions}>
              <Pressable
                style={lbStyles.actionBtn}
                onPress={() => { setLightboxOpen(false); pick(); }}
                testID={`${testID}-lightbox-edit`}
              >
                <Feather name="edit-2" size={16} color={theme.color.onSurface} />
                <Text style={lbStyles.actionTxt}>{t('photo.change')}</Text>
              </Pressable>
              <Pressable
                style={[lbStyles.actionBtn, lbStyles.actionDanger]}
                onPress={remove}
                testID={`${testID}-lightbox-remove`}
              >
                <Feather name="trash-2" size={16} color={theme.color.error} />
                <Text style={[lbStyles.actionTxt, { color: theme.color.error }]}>{t('common.remove')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Enlarge a read-only thumbnail on tap (used inside DishEditor ingredient rows). */
export function PhotoLightboxThumb({
  path, size = 44, rounded = false, fallbackIcon = 'image', testID,
}: { path?: string | null; size?: number; rounded?: boolean; fallbackIcon?: any; testID?: string }) {
  const { uri, headers } = usePhotoUrl(path);
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const borderRadius = rounded ? size / 2 : theme.radius.sm;
  const win = Dimensions.get('window');
  const boxSize = Math.min(win.width, win.height) * 0.86;

  if (!path) {
    return (
      <View style={[styles.thumbFallback, { width: size, height: size, borderRadius }]}>
        <Feather name={fallbackIcon} size={size / 2.4} color={theme.color.onSurfaceTertiary} />
      </View>
    );
  }
  if (!uri) {
    return <View style={[styles.thumbFallback, { width: size, height: size, borderRadius }]} />;
  }
  return (
    <>
      <Pressable onPress={() => setOpen(true)} testID={testID} hitSlop={4}>
        <Image
          source={{ uri, headers }}
          style={{ width: size, height: size, borderRadius, backgroundColor: theme.color.surfaceSecondary }}
          resizeMode="cover"
        />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={lbStyles.overlay} onPress={() => setOpen(false)}>
          <Pressable onPress={e => e.stopPropagation?.()} style={lbStyles.card}>
            <Pressable style={lbStyles.closeBtn} onPress={() => setOpen(false)}>
              <Feather name="x" size={22} color="#fff" />
            </Pressable>
            <Image
              source={{ uri, headers }}
              style={{ width: boxSize, height: boxSize, borderRadius: theme.radius.lg }}
              resizeMode="contain"
            />
            <Text style={lbStyles.hint}>{t('photo.tapToClose')}</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/** Read-only thumbnail for lists. */
export function PhotoThumb({
  path,
  size = 44,
  rounded = false,
  fallbackIcon = 'image',
  fallbackEmoji,
}: { path?: string | null; size?: number; rounded?: boolean; fallbackIcon?: any; fallbackEmoji?: string }) {
  const { uri, headers } = usePhotoUrl(path);
  const borderRadius = rounded ? size / 2 : theme.radius.sm;
  if (!path) {
    return (
      <View style={[styles.thumbFallback, { width: size, height: size, borderRadius }]}>
        {fallbackEmoji ? (
          <Text style={{ fontSize: size * 0.55 }}>{fallbackEmoji}</Text>
        ) : (
          <Feather name={fallbackIcon} size={size / 2.4} color={theme.color.onSurfaceTertiary} />
        )}
      </View>
    );
  }
  if (!uri) {
    return <View style={[styles.thumbFallback, { width: size, height: size, borderRadius }]} />;
  }
  return (
    <Image
      source={{ uri, headers }}
      style={{ width: size, height: size, borderRadius, backgroundColor: theme.color.surfaceSecondary }}
      resizeMode="cover"
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceSecondary,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrapEmpty: {
    borderStyle: 'dashed',
  },
  busy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  proBadge: {
    position: 'absolute', top: 4, right: 4,
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 8, backgroundColor: theme.color.brand,
  },
  proBadgeTxt: { color: '#fff', fontWeight: '700', fontSize: 9 },
  remove: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  removeTxt: { color: theme.color.error, fontSize: 11, fontWeight: '500' },
  thumbFallback: {
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
    alignItems: 'center', justifyContent: 'center',
  },
});

const lbStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center', justifyContent: 'center',
  },
  card: {
    alignItems: 'center', gap: theme.spacing.md,
  },
  closeBtn: {
    position: 'absolute', top: -50, right: -8, zIndex: 2,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row', gap: 12, marginTop: 6,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 12,
    backgroundColor: theme.color.surface, borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: theme.color.border,
  },
  actionDanger: { backgroundColor: '#FEF2F0', borderColor: '#F5C7C0' },
  actionTxt: { color: theme.color.onSurface, fontWeight: '600', fontSize: 14 },
  hint: { color: 'rgba(255,255,255,0.65)', fontSize: 12, fontStyle: 'italic' },
});
