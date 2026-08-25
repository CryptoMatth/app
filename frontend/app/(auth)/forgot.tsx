import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  ActivityIndicator, Keyboard,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';

export default function Forgot() {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { recoveryVerify } = useAuth();
  const router = useRouter();

  const submit = async () => {
    Keyboard.dismiss();
    setErr('');
    if (!username.trim() || !code.trim() || !pw) { setErr('Compila tutti i campi'); return; }
    if (pw.length < 6) { setErr('La password deve avere almeno 6 caratteri'); return; }
    if (pw !== pw2) { setErr('Le due password non coincidono'); return; }
    setBusy(true);
    try {
      await recoveryVerify(username.trim(), code.trim(), pw);
      router.replace('/(tabs)/planner');
    } catch (e: any) {
      setErr(e.message || 'Codice non valido');
    }
    setBusy(false);
  };

  return (
    <View style={styles.root} testID="forgot-screen">
      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bottomOffset={20}>
        <Pressable onPress={() => router.back()} style={styles.back} testID="forgot-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.h1}>Recupero password</Text>
        <Text style={styles.sub}>
          Inserisci il tuo username e uno dei codici di recupero salvati durante la registrazione. Ogni codice può essere usato una sola volta.
        </Text>

        <View style={{ height: theme.spacing.xl }} />
        <TextInput
          testID="forgot-username-input"
          placeholder="Username"
          placeholderTextColor={theme.color.onSurfaceTertiary}
          value={username} onChangeText={setUsername}
          autoCapitalize="none" autoCorrect={false}
          style={styles.input}
        />
        <TextInput
          testID="forgot-code-input"
          placeholder="Codice (es. AB3F-K9XM)"
          placeholderTextColor={theme.color.onSurfaceTertiary}
          value={code} onChangeText={setCode}
          autoCapitalize="characters" autoCorrect={false}
          style={styles.input}
        />
        <TextInput
          testID="forgot-newpw-input"
          placeholder="Nuova password (min 6)"
          placeholderTextColor={theme.color.onSurfaceTertiary}
          value={pw} onChangeText={setPw}
          secureTextEntry
          style={styles.input}
        />
        <TextInput
          testID="forgot-newpw2-input"
          placeholder="Ripeti nuova password"
          placeholderTextColor={theme.color.onSurfaceTertiary}
          value={pw2} onChangeText={setPw2}
          secureTextEntry
          style={styles.input}
        />
        {err ? <Text style={styles.err} testID="forgot-error">{err}</Text> : null}

        <Pressable
          testID="forgot-reset-button"
          onPress={submit}
          disabled={busy}
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryTxt}>Reimposta password</Text>}
        </Pressable>

        <Text style={styles.hint}>
          Non hai più i codici? Puoi comunque creare un nuovo account con un nome utente diverso e ripristinare i tuoi dati da un file di backup precedentemente esportato.
        </Text>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  scroll: { padding: theme.spacing.xl, paddingTop: 80, paddingBottom: 40 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md, marginLeft: -8 },
  h1: { fontFamily: theme.font.display, fontSize: 28, color: theme.color.onSurface },
  sub: { fontSize: 14, color: theme.color.onSurfaceSecondary, marginTop: 6, lineHeight: 20 },
  input: {
    height: 52, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    paddingHorizontal: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary,
    color: theme.color.onSurface, fontSize: 15, marginBottom: theme.spacing.md,
  },
  primary: { height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary, alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.sm },
  primaryTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
  err: { color: theme.color.error, fontSize: 13, marginBottom: theme.spacing.sm },
  hint: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.xl, lineHeight: 17, fontStyle: 'italic' },
});
