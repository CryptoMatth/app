import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Platform,
  ActivityIndicator, Keyboard,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, Link } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';

WebBrowser.maybeCompleteAuthSession();

const HERO_URL = 'https://images.unsplash.com/photo-1528712306091-ed0763094c98?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1OTN8MHwxfHNlYXJjaHwxfHxjb3p5JTIwaG9tZSUyMGNvb2tpbmclMjBraXRjaGVufGVufDB8fHx8MTc4NzMxNTg1NHww&ixlib=rb-4.1.0&q=85';

export default function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [googleBusy, setGoogleBusy] = useState(false);
  const { loginEmail, loginWithGoogleSession } = useAuth();
  const router = useRouter();
  const handledSessionIds = useRef<Set<string>>(new Set());

  const handleSessionUrl = useCallback(async (url: string | null | undefined) => {
    if (!url) return;
    const match = url.match(/[?#&]session_id=([^&#]+)/);
    if (!match) return;
    const sid = decodeURIComponent(match[1]);
    if (handledSessionIds.current.has(sid)) return;
    handledSessionIds.current.add(sid);
    try {
      setGoogleBusy(true);
      await loginWithGoogleSession(sid);
      router.replace('/(tabs)/planner');
    } catch (e: any) {
      setErr(e.message || 'Errore login Google');
    } finally {
      setGoogleBusy(false);
    }
  }, [loginWithGoogleSession, router]);

  useEffect(() => {
    // Handle cold start / warm deep links
    (async () => {
      const initial = await Linking.getInitialURL();
      handleSessionUrl(initial);
    })();
    const sub = Linking.addEventListener('url', (event) => handleSessionUrl(event.url));
    return () => sub.remove();
  }, [handleSessionUrl]);

  const onGoogle = async () => {
    setErr('');
    try {
      const redirect = Platform.OS === 'web' ? (window.location.origin + '/') : Linking.createURL('');
      const url = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
      if (Platform.OS === 'web') {
        window.location.href = url;
        return;
      }
      setGoogleBusy(true);
      const res = await WebBrowser.openAuthSessionAsync(url, redirect);
      if (res.type === 'success' && (res as any).url) {
        await handleSessionUrl((res as any).url);
      }
    } catch (e: any) {
      setErr(e.message || 'Login Google fallito');
    } finally {
      setGoogleBusy(false);
    }
  };

  const onEmail = async () => {
    Keyboard.dismiss();
    setErr('');
    if (!email.trim() || !pw) { setErr('Inserisci email e password'); return; }
    setBusy(true);
    try {
      await loginEmail(email.trim(), pw);
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
            <Text style={styles.title}>Benvenuto</Text>
            <Text style={styles.subtitle}>Accedi per sincronizzare i tuoi piatti su ogni dispositivo.</Text>

            <View style={{ height: theme.spacing.lg }} />
            <Pressable
              testID="login-google-button"
              onPress={onGoogle}
              disabled={googleBusy}
              style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.85 }]}
            >
              {googleBusy ? <ActivityIndicator color="#3D342B" /> : (
                <>
                  <Feather name="log-in" size={18} color="#3D342B" />
                  <Text style={styles.googleTxt}>Continua con Google</Text>
                </>
              )}
            </Pressable>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerTxt}>oppure</Text>
              <View style={styles.dividerLine} />
            </View>

            <TextInput
              testID="login-email-input"
              placeholder="Email"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <TextInput
              testID="login-password-input"
              placeholder="Password"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              value={pw}
              onChangeText={setPw}
              secureTextEntry
              style={styles.input}
            />
            {err ? <Text style={styles.err} testID="login-error">{err}</Text> : null}

            <Pressable
              testID="login-submit-button"
              onPress={onEmail}
              disabled={busy}
              style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryTxt}>Accedi</Text>}
            </Pressable>

            <Link href="/(auth)/forgot" asChild>
              <Pressable testID="go-to-forgot" style={styles.forgotBtn}>
                <Text style={styles.forgotTxt}>Password dimenticata?</Text>
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
  googleBtn: {
    height: 50, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.borderStrong,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: theme.color.surface,
  },
  googleTxt: { fontSize: 15, color: theme.color.onSurface, fontWeight: '500' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: theme.spacing.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: theme.color.divider },
  dividerTxt: { fontSize: 12, color: theme.color.onSurfaceTertiary },
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
  linkBtn: { alignItems: 'center', paddingVertical: theme.spacing.md },
  linkTxt: { fontSize: 14, color: theme.color.onSurfaceSecondary },
  forgotBtn: { alignItems: 'center', paddingVertical: theme.spacing.sm, marginTop: theme.spacing.sm },
  forgotTxt: { fontSize: 13, color: theme.color.brandPrimary, fontWeight: '500' },
  err: { color: theme.color.error, fontSize: 13, marginBottom: theme.spacing.sm },
});
