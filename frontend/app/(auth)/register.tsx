import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, Keyboard,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRouter, Link } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { PasswordInput } from '@/src/PasswordInput';

export default function Register() {
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { register } = useAuth();
  const router = useRouter();

  const onSubmit = async () => {
    Keyboard.dismiss();
    setErr('');
    if (!username.trim() || !pw) { setErr('Inserisci username e password'); return; }
    if (pw.length < 6) { setErr('La password deve avere almeno 6 caratteri'); return; }
    if (pw !== pw2) { setErr('Le due password non coincidono'); return; }
    setBusy(true);
    try {
      const codes = await register(username.trim(), pw, pw2);
      router.replace({ pathname: '/(auth)/recovery-codes', params: { codes: codes.join(',') } });
    } catch (e: any) {
      setErr(e.message || 'Errore registrazione');
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
        <Text style={styles.h1}>Crea il tuo account</Text>
        <Text style={styles.sub}>Scegli uno username e una password. Nessuna email necessaria.</Text>

        <View style={{ height: theme.spacing.xl }} />
        <TextInput
          testID="register-username-input"
          placeholder="Username (es. marco, chiara.rossi)"
          placeholderTextColor={theme.color.onSurfaceTertiary}
          value={username} onChangeText={setUsername}
          autoCapitalize="none" autoCorrect={false}
          style={styles.input}
        />
        <PasswordInput
          testID="register-password-input"
          placeholder="Password (min 6 caratteri)"
          value={pw} onChangeText={setPw}
          style={styles.input}
          toggleTestID="register-password-toggle"
        />
        <PasswordInput
          testID="register-password2-input"
          placeholder="Ripeti password"
          value={pw2} onChangeText={setPw2}
          style={styles.input}
          toggleTestID="register-password2-toggle"
        />
        {err ? <Text style={styles.err} testID="register-error">{err}</Text> : null}
        <Text style={styles.helper}>Username: 3-30 caratteri. Solo lettere, numeri, punto (.) e underscore (_).</Text>

        <Pressable
          testID="register-submit-button"
          onPress={onSubmit}
          disabled={busy}
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryTxt}>Registrati</Text>}
        </Pressable>

        <Link href="/(auth)/login" asChild>
          <Pressable style={styles.link} testID="go-to-login">
            <Text style={styles.linkTxt}>Hai già un account? <Text style={{ fontWeight: '600', color: theme.color.brandPrimary }}>Accedi</Text></Text>
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
});
