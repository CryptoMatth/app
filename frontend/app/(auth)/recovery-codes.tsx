import { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { theme } from '@/src/theme';
import { useTranslation } from '@/src/i18n';

export default function RecoveryCodes() {
  const router = useRouter();
  const { t } = useTranslation();
  const { codes } = useLocalSearchParams<{ codes: string }>();
  const list = (codes as string | undefined)?.split(',') || [];
  const [ack, setAck] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const copy = async () => {
    await Clipboard.setStringAsync(list.join('\n'));
    setCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopied(false), 2500);
  };

  const download = async () => {
    const text = t('rec.fileTxt', { list: list.join('\n') });
    if (Platform.OS === 'web') {
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'planeat-recovery-codes.txt';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      const path = `${FileSystem.documentDirectory}planeat-recovery-codes.txt`;
      await FileSystem.writeAsStringAsync(path, text);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: t('rec.fileDialog') });
      }
    }
    setDownloaded(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setDownloaded(false), 2500);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="recovery-codes-screen">
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xl }}>
        <View style={styles.iconBox}>
          <Feather name="shield" size={32} color={theme.color.brandPrimary} />
        </View>
        <Text style={styles.h1}>{t('rec.saveTitle')}</Text>
        <Text style={styles.sub}>
          {t('rec.saveSub')}
        </Text>

        <View style={styles.codesBox}>
          {list.map((c, i) => (
            <Text key={i} style={styles.code} selectable testID={`recovery-code-${i}`}>{c}</Text>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
          <Pressable onPress={copy} style={styles.secBtn} testID="copy-codes">
            <Feather name={copied ? 'check' : 'copy'} size={16} color={theme.color.onSurface} />
            <Text style={styles.secTxt}>{copied ? t('common.copied') : t('common.copy')}</Text>
          </Pressable>
          <Pressable onPress={download} style={styles.secBtn} testID="download-codes">
            <Feather name={downloaded ? 'check' : 'download'} size={16} color={theme.color.onSurface} />
            <Text style={styles.secTxt}>{downloaded ? t('common.saved') : t('common.saveFile')}</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => setAck(a => !a)} style={styles.ackRow} testID="ack-checkbox">
          <View style={[styles.checkbox, ack && styles.checkboxOn]}>
            {ack && <Feather name="check" size={14} color="#fff" />}
          </View>
          <Text style={styles.ackTxt}>{t('rec.ack')}</Text>
        </Pressable>

        <Pressable
          onPress={() => router.replace('/tutorial')}
          disabled={!ack}
          style={[styles.primary, !ack && { opacity: 0.4 }]}
          testID="codes-continue"
        >
          <Text style={styles.primaryTxt}>{t('common.continue')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  iconBox: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.color.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.lg, alignSelf: 'flex-start' },
  h1: { fontFamily: theme.font.display, fontSize: 26, color: theme.color.onSurface },
  sub: { fontSize: 14, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.sm, lineHeight: 20 },
  codesBox: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, padding: theme.spacing.lg, marginTop: theme.spacing.xl, alignItems: 'center', gap: 8 },
  code: { fontFamily: theme.font.display, fontSize: 20, color: theme.color.brandPrimary, letterSpacing: 3, fontWeight: '600' },
  secBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.border, backgroundColor: theme.color.surfaceSecondary },
  secTxt: { fontSize: 14, fontWeight: '500', color: theme.color.onSurface },
  ackRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: theme.spacing.xl, padding: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: theme.color.borderStrong, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  ackTxt: { flex: 1, fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 18 },
  primary: { height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.lg },
  primaryTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
