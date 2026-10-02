import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, Keyboard, Image,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, Link } from 'expo-router';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { PasswordInput } from '@/src/PasswordInput';
import { useTranslation } from '@/src/i18n';

export default function Login() {
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { loginUsername } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();

  const onSubmit = async () => {
    Keyboard.dismiss();
    setErr('');
    if (!username.trim() || !pw) { setErr(t('auth.errors.missing')); return; }
    setBusy(true);
    try {
      await loginUsername(username.trim(), pw);
      router.replace('/(tabs)/planner');
    } catch (e: any) {
      setErr(e.message || t('auth.errors.login'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root} testID="login-screen">
      {/* Planibble brand gradient — teal petrol → cyan-aqua, mirrors the logo. */}
      <LinearGradient
        colors={['#1D8EA2', '#2FA6BA', '#4FB3C5']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Soft radial-ish darken at the top to keep the tagline readable */}
      <LinearGradient
        colors={['rgba(14,42,54,0.28)', 'rgba(14,42,54,0)']}
        locations={[0, 0.6]}
        style={StyleSheet.absoluteFillObject}
      />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
          <View style={styles.top}>
            <Image
              source={require('@/assets/images/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.brand}>Planibble</Text>
            <Text style={styles.tagline}>{t('auth.login.tagline')}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>{t('auth.login.welcome')}</Text>
            <Text style={styles.subtitle}>{t('auth.login.sub')}</Text>

            <View style={{ height: theme.spacing.lg }} />

            <TextInput
              testID="login-username-input"
              placeholder={t('auth.username')}
              placeholderTextColor={theme.color.onSurfaceTertiary}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <PasswordInput
              testID="login-password-input"
              placeholder={t('auth.password')}
              value={pw}
              onChangeText={setPw}
              style={styles.input}
              toggleTestID="login-password-toggle"
            />
            {err ? <Text style={styles.err} testID="login-error">{err}</Text> : null}

            <Pressable
              testID="login-submit-button"
              onPress={onSubmit}
              disabled={busy}
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryTxt}>{t('auth.login')}</Text>}
            </Pressable>

            <Link href="/(auth)/forgot" asChild>
              <Pressable testID="go-to-forgot" style={styles.linkBtn}>
                <Text style={[styles.linkTxt, { color: theme.color.brandPrimary }]}>{t('auth.forgot')}</Text>
              </Pressable>
            </Link>

            <Link href="/(auth)/register" asChild>
              <Pressable testID="go-to-register" style={styles.linkBtn}>
                <Text style={styles.linkTxt}>{t('auth.noAccount')} <Text style={{ fontWeight: '600', color: theme.color.brandPrimary }}>{t('auth.register')}</Text></Text>
              </Pressable>
            </Link>
          </View>
        </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.brand },
  scroll: { flexGrow: 1, justifyContent: 'space-between', paddingHorizontal: theme.spacing.xl, paddingTop: 80, paddingBottom: theme.spacing.xl },
  top: { alignItems: 'center' },
  logo: { width: 96, height: 96, borderRadius: 20, marginBottom: theme.spacing.sm },
  brand: { fontFamily: theme.font.display, fontSize: 38, color: '#FDFBF7', letterSpacing: 0.5, textAlign: 'center' },
  tagline: { fontSize: 15, color: 'rgba(253,251,247,0.9)', marginTop: 6, textAlign: 'center' },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  title: { fontFamily: theme.font.display, fontSize: 24, color: theme.color.onSurface },
  subtitle: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 4 },
  input: {
    height: 48, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    paddingHorizontal: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary,
    color: theme.color.onSurface, fontSize: 15, marginBottom: theme.spacing.md,
  },
  primaryBtn: {
    height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary,
    alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.sm,
  },
  primaryTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
  linkBtn: { alignItems: 'center', paddingVertical: theme.spacing.md, marginTop: theme.spacing.sm },
  linkTxt: { fontSize: 14, color: theme.color.onSurfaceSecondary },
  err: { color: theme.color.error, fontSize: 13, marginBottom: theme.spacing.sm },
});
