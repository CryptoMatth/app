import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, Keyboard,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRouter, Link } from 'expo-router';
import Feather from '@react-native-vector-icons/feather';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { PasswordInput } from '@/src/PasswordInput';
import { useTranslation } from '@/src/i18n';

export default function Register() {
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { register } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();

  const onSubmit = async () => {
    Keyboard.dismiss();
    setErr('');
    if (!username.trim() || !pw) { setErr(t('auth.errors.missing')); return; }
    if (pw.length < 6) { setErr(t('auth.register.pwShort')); return; }
    if (pw !== pw2) { setErr(t('auth.register.pwMismatch')); return; }
    if (!accepted) { setErr(t('auth.register.mustAcceptPrivacy')); return; }
    setBusy(true);
    try {
      const codes = await register(username.trim(), pw, pw2);
      router.replace({ pathname: '/(auth)/recovery-codes', params: { codes: codes.join(',') } });
    } catch (e: any) {
      setErr(e.message || t('auth.register.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root} testID="register-screen">
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <Pressable onPress={() => router.back()} style={styles.back} testID="register-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.h1}>{t('auth.register.title')}</Text>
        <Text style={styles.sub}>{t('auth.register.sub')}</Text>

        <View style={{ height: theme.spacing.xl }} />
        <TextInput
          testID="register-username-input"
          placeholder={t('auth.register.usernamePh')}
          placeholderTextColor={theme.color.onSurfaceTertiary}
          value={username} onChangeText={setUsername}
          autoCapitalize="none" autoCorrect={false}
          style={styles.input}
        />
        <PasswordInput
          testID="register-password-input"
          placeholder={t('auth.register.pwPh')}
          value={pw} onChangeText={setPw}
          style={styles.input}
          toggleTestID="register-password-toggle"
        />
        <PasswordInput
          testID="register-password2-input"
          placeholder={t('auth.register.pw2Ph')}
          value={pw2} onChangeText={setPw2}
          style={styles.input}
          toggleTestID="register-password2-toggle"
        />
        {err ? <Text style={styles.err} testID="register-error">{err}</Text> : null}
        <Text style={styles.helper}>{t('auth.register.helper')}</Text>

        {/* Privacy Policy acceptance (GDPR) */}
        <Pressable
          onPress={() => setAccepted(a => !a)}
          style={styles.privacyRow}
          testID="privacy-accept"
        >
          <View style={[styles.checkbox, accepted && styles.checkboxOn]}>
            {accepted && <Feather name="check" size={13} color="#fff" />}
          </View>
          <Text style={styles.privacyTxt}>
            {t('auth.register.privacy.accept1')}
            <Text
              style={styles.privacyLink}
              onPress={() => router.push('/privacy-policy')}
            > {t('auth.register.privacy.link')}</Text>
            {t('auth.register.privacy.accept2')}
          </Text>
        </Pressable>

        <Pressable
          testID="register-submit-button"
          onPress={onSubmit}
          disabled={busy}
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryTxt}>{t('auth.register')}</Text>}
        </Pressable>

        <Link href="/(auth)/login" asChild>
          <Pressable style={styles.link} testID="go-to-login">
            <Text style={styles.linkTxt}>{t('auth.haveAccount')} <Text style={{ fontWeight: '600', color: theme.color.brandPrimary }}>{t('auth.login')}</Text></Text>
          </Pressable>
        </Link>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  scroll: { padding: theme.spacing.xl, paddingTop: 80, paddingBottom: 40 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md, marginLeft: -8 },
  h1: { fontFamily: theme.font.display, fontSize: 30, color: theme.color.onSurface },
  sub: { fontSize: 14, color: theme.color.onSurfaceSecondary, marginTop: 4 },
  helper: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: -4, marginBottom: theme.spacing.md },
  input: {
    height: 52, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    paddingHorizontal: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary,
    color: theme.color.onSurface, fontSize: 15, marginBottom: theme.spacing.md,
  },
  primary: {
    height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary,
    alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.sm,
  },
  primaryTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
  link: { alignItems: 'center', paddingVertical: theme.spacing.lg },
  linkTxt: { color: theme.color.onSurfaceSecondary, fontSize: 14 },
  err: { color: theme.color.error, fontSize: 13, marginBottom: theme.spacing.sm },
  privacyRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingVertical: theme.spacing.sm, marginBottom: theme.spacing.sm,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 1.5,
    borderColor: theme.color.borderStrong, alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: theme.color.brandPrimary, borderColor: theme.color.brandPrimary },
  privacyTxt: { flex: 1, fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 18 },
  privacyLink: { color: theme.color.brandPrimary, fontWeight: '600', textDecorationLine: 'underline' },
});
