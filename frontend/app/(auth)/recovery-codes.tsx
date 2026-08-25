import { useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { theme } from '@/src/theme';

export default function RecoveryCodes() {
  const router = useRouter();
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
    const text = `PlanEat — Codici di recupero\n\n${list.join('\n')}\n\nConservali in un luogo sicuro. Servono per reimpostare la password se la dimentichi.\nOgni codice può essere usato UNA SOLA volta.`;
    if (Platform.OS === 'web') {
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'planeat-codici-recupero.txt';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      const path = `${FileSystem.documentDirectory}planeat-codici-recupero.txt`;
      await FileSystem.writeAsStringAsync(path, text);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: 'Salva i codici' });
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
        <Text style={styles.h1}>Salva i tuoi codici di recupero</Text>
        <Text style={styles.sub}>
          Se dimentichi la password, questi codici sono l'UNICO modo per rientrare nel tuo account.
          Non li rivedrai più dopo aver chiuso questa pagina.
        </Text>

        <View style={styles.codesBox}>
          {list.map((c, i) => (
            <Text key={i} style={styles.code} selectable testID={`recovery-code-${i}`}>{c}</Text>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.md }}>
          <Pressable onPress={copy} style={styles.secBtn} testID="copy-codes">
            <Feather name={copied ? 'check' : 'copy'} size={16} color={theme.color.onSurface} />
            <Text style={styles.secTxt}>{copied ? 'Copiati' : 'Copia'}</Text>
          </Pressable>
          <Pressable onPress={download} style={styles.secBtn} testID="download-codes">
            <Feather name={downloaded ? 'check' : 'download'} size={16} color={theme.color.onSurface} />
            <Text style={styles.secTxt}>{downloaded ? 'Salvato' : 'Salva file'}</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => setAck(a => !a)} style={styles.ackRow} testID="ack-checkbox">
          <View style={[styles.checkbox, ack && styles.checkboxOn]}>
            {ack && <Feather name="check" size={14} color="#fff" />}
          </View>
          <Text style={styles.ackTxt}>Ho salvato i codici in un luogo sicuro. Capisco che se li perdo non potrò più recuperare la password.</Text>
        </Pressable>

        <Pressable
          onPress={() => router.replace('/(tabs)/planner')}
          disabled={!ack}
          style={[styles.primary, !ack && { opacity: 0.4 }]}
          testID="codes-continue"
        >
          <Text style={styles.primaryTxt}>Continua</Text>
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
