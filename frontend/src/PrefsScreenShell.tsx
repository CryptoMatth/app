/**
 * Standardised chrome (header + save + toast) for every preferences sub-editor.
 * Sub-pages just supply the title and children; the shell handles submit UX.
 */
import { ReactNode, useEffect, useState } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, StyleSheet, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Feather from '@react-native-vector-icons/feather';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { theme } from './theme';
import { settingsStyles as s } from './settingsStyles';
import { useTranslation } from './i18n';

type Msg = { kind: 'ok' | 'err'; text: string } | null;

type Props = {
  title: string;
  dirty: boolean;
  onSave: () => Promise<void> | void;
  testID?: string;
  children: ReactNode;
  scrollType?: 'scroll' | 'kb' | 'none';
};

export function PrefsScreenShell({ title, dirty, onSave, testID, children, scrollType = 'kb' }: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    if (!msg) return;
    const timer = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(timer);
  }, [msg]);

  const handleSave = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    try {
      await onSave();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMsg({ kind: 'ok', text: t('prefs.saved') });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || t('prefs.errors.saveGen') });
    }
    setBusy(false);
  };

  const content = (
    <>
      {children}
      {msg ? (
        <View style={[s.msgBox, msg.kind === 'err' ? s.msgErr : s.msgOk]} testID="prefs-msg">
          <Feather
            name={msg.kind === 'err' ? 'alert-circle' : 'check-circle'}
            size={16}
            color={msg.kind === 'err' ? theme.color.error : theme.color.success}
          />
          <Text style={[s.msgTxt, { color: msg.kind === 'err' ? theme.color.error : theme.color.success }]}>
            {msg.text}
          </Text>
        </View>
      ) : null}
    </>
  );

  return (
    <SafeAreaView style={s.root} edges={['top']} testID={testID}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back} testID="prefs-shell-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={s.h1} numberOfLines={1}>{title}</Text>
        <Pressable
          onPress={handleSave}
          disabled={!dirty || busy}
          style={styles.saveHeader}
          testID="prefs-shell-save"
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.color.brandPrimary} />
          ) : (
            <Text style={[styles.saveHeaderTxt, !dirty && { color: theme.color.onSurfaceTertiary }]}>
              {t('common.save')}
            </Text>
          )}
        </Pressable>
      </View>

      {scrollType === 'none' ? (
        <View style={{ flex: 1, padding: theme.spacing.lg }}>{content}</View>
      ) : scrollType === 'scroll' ? (
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 60 }}>
          {content}
        </ScrollView>
      ) : (
        <KeyboardAwareScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 60 }}>
          {content}
        </KeyboardAwareScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  saveHeader: { minWidth: 60, height: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.spacing.sm },
  saveHeaderTxt: { color: theme.color.brandPrimary, fontWeight: '600', fontSize: 15 },
});
