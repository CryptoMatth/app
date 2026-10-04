import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import * as Haptics from 'expo-haptics';
import { theme } from '@/src/theme';
import { hasSeenTip, markTipSeen, subscribeTipsVersion } from '@/src/tutorial';

type Props = {
  storageKey: string;
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
  testID?: string;
};

/**
 * Small dismissible informative banner. Shown once per user per key
 * (stored in AsyncStorage). Non-blocking and non-intrusive.
 *
 * Subscribes to the shared "tips version" counter so a global
 * `resetAllTutorial()` call re-materialises the banner without
 * requiring an app restart.
 */
export function TipBanner({ storageKey, icon = 'info', title, body, testID }: Props) {
  const [visible, setVisible] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Re-read whenever the global tips version bumps (e.g. user hits
  // "Mostra di nuovo i suggerimenti" in Settings).
  useEffect(() => subscribeTipsVersion(() => setReloadToken(t => t + 1)), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = await hasSeenTip(storageKey);
      if (!cancelled) setVisible(!seen);
    })();
    return () => { cancelled = true; };
  }, [storageKey, reloadToken]);

  if (!visible) return null;

  const dismiss = async () => {
    try { Haptics.selectionAsync(); } catch {}
    await markTipSeen(storageKey);
    setVisible(false);
  };

  return (
    <View style={styles.wrap} testID={testID || `tip-${storageKey}`}>
      <View style={styles.iconWrap}>
        <Feather name={icon} size={16} color={theme.color.brandPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
      <Pressable onPress={dismiss} style={styles.close} hitSlop={10} testID={`${testID || 'tip'}-close`}>
        <Feather name="x" size={16} color={theme.color.onSurfaceSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: theme.color.brandTertiary,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1, borderColor: '#B9DBE2',
  },
  iconWrap: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  title: { fontSize: 13, fontWeight: '600', color: theme.color.onSurface, marginBottom: 2 },
  body: { fontSize: 12, color: theme.color.onSurfaceSecondary, lineHeight: 17 },
  close: { padding: 4 },
});
