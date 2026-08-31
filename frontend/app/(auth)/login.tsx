import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, Keyboard,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, Link } from 'expo-router';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { PasswordInput } from '@/src/PasswordInput';

const HERO_URL = 'https://images.unsplash.com/photo-1528712306091-ed0763094c98?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1OTN8MHwxfHNlYXJjaHwxfHxjb3p5JTIwaG9tZSUyMGNvb2tpbmclMjBraXRjaGVufGVufDB8fHx8MTc4NzMxNTg1NHww&ixlib=rb-4.1.0&q=85';

export default function Login() {
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { loginUsername } = useAuth();
  const router = useRouter();

  const onSubmit = async () => {
    Keyboard.dismiss();
    setErr('');
    if (!username.trim() || !pw) { setErr('Inserisci username e password'); return; }
    setBusy(true);
    try {
      await loginUsername(username.trim(), pw);
      router.replace('/(tabs)/planner');
    } catch (e: any) {
      setErr(e.message || 'Errore di accesso');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root} testID="login-screen">
      <Image source={{ uri: HERO_URL }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
      <LinearGradient
        colors={['rgba(44,40,38,0.25)', 'rgba(44,40,38,0.55)', 'rgba(44,40,38,0.92)']}
        style={StyleSheet.absoluteFillObject}
      />
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
          <View style={styles.top}>
            <Text style={styles.brand}>PlanEat</Text>
            <Text style={styles.tagline}>Pianifica i pasti, semplifica la spesa.</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>Bentornato</Text>
            <Text style={styles.subtitle}>Accedi per sincronizzare i tuoi piatti su ogni dispositivo.</Text>

            <View style={{ height: theme.spacing.lg }} />

            <TextInput
              testID="login-username-input"
              placeholder="Username"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <PasswordInput
              testID="login-password-input"
              placeholder="Password"
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
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryTxt}>Accedi</Text>}
            </Pressable>

            <Link href="/(auth)/forgot" asChild>
              <Pressable testID="go-to-forgot" style={styles.linkBtn}>
                <Text style={[styles.linkTxt, { color: theme.color.brandPrimary }]}>Password dimenticata?</Text>
              </Pressable>
            </Link>

            <Link href="/(auth)/register" asChild>
              <Pressable testID="go-to-register" style={styles.linkBtn}>
                <Text style={styles.linkTxt}>Non hai un account? <Text style={{ fontWeight: '600', color: theme.color.brandPrimary }}>Registrati</Text></Text>
              </Pressable>
            </Link>
          </View>
        </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surfaceInverse },
  scroll: { flexGrow: 1, justifyContent: 'space-between', paddingHorizontal: theme.spacing.xl, paddingTop: 80, paddingBottom: theme.spacing.xl },
  top: { alignItems: 'flex-start' },
  brand: { fontFamily: theme.font.display, fontSize: 38, color: '#FDFBF7', letterSpacing: 0.5 },
  tagline: { fontSize: 16, color: 'rgba(253,251,247,0.85)', marginTop: 6 },
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
