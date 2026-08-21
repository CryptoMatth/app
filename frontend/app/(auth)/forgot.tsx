import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Keyboard,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { api } from '@/src/api';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';

export default function ForgotPassword() {
  const router = useRouter();
  const { resetPassword } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  const sendCode = async () => {
    Keyboard.dismiss();
    setErr(''); setInfo('');
    if (!email.trim()) { setErr('Inserisci la tua email'); return; }
    setBusy(true);
    try {
      await api.forgotPassword(email.trim());
      setInfo('Se l\'email è registrata, riceverai un codice a 6 cifre entro pochi istanti. Controlla anche lo spam.');
      setStep('code');
    } catch (e: any) {
      setErr(e.message || 'Errore invio email');
    }
    setBusy(false);
  };

  const submitReset = async () => {
    Keyboard.dismiss();
    setErr('');
    if (code.trim().length !== 6) { setErr('Il codice deve avere 6 cifre'); return; }
    if (pw.length < 6) { setErr('Password troppo corta (min 6)'); return; }
    if (pw !== pw2) { setErr('Le due password non coincidono'); return; }
    setBusy(true);
    try {
      await resetPassword(email.trim(), code.trim(), pw);
      router.replace('/(tabs)/planner');
    } catch (e: any) {
      setErr(e.message || 'Codice non valido');
    }
    setBusy(false);
  };

  return (
    <View style={styles.root} testID="forgot-screen">
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <Pressable onPress={() => router.back()} style={styles.back} testID="forgot-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.h1}>{step === 'email' ? 'Password dimenticata' : 'Inserisci il codice'}</Text>
        <Text style={styles.sub}>
          {step === 'email'
            ? 'Ti invieremo un codice a 6 cifre via email per reimpostare la password.'
            : `Codice inviato a ${email}. Se non lo trovi, controlla lo spam.`}
        </Text>

        <View style={{ height: theme.spacing.xl }} />

        {step === 'email' ? (
          <>
            <TextInput
              testID="forgot-email-input"
              placeholder="Email"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              value={email} onChangeText={setEmail}
              autoCapitalize="none" keyboardType="email-address"
              style={styles.input}
            />
            {info ? <Text style={styles.info} testID="forgot-info">{info}</Text> : null}
            {err ? <Text style={styles.err} testID="forgot-error">{err}</Text> : null}
            <Pressable
              testID="forgot-send-button"
              onPress={sendCode}
              disabled={busy}
              style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryTxt}>Invia codice</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <TextInput
              testID="forgot-code-input"
              placeholder="Codice a 6 cifre"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              value={code} onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              style={[styles.input, styles.codeInput]}
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
              onPress={submitReset}
              disabled={busy}
              style={({ pressed }) => [styles.primary, pressed && { opacity: 0.9 }]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryTxt}>Reimposta password</Text>}
            </Pressable>
            <Pressable
              testID="forgot-resend"
              onPress={() => { setStep('email'); setCode(''); setPw(''); setPw2(''); }}
              style={styles.link}
            >
              <Text style={styles.linkTxt}>Non hai ricevuto il codice? <Text style={{ color: theme.color.brandPrimary, fontWeight: '600' }}>Reinvia</Text></Text>
            </Pressable>
          </>
        )}
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
  codeInput: { fontSize: 22, letterSpacing: 8, textAlign: 'center', fontFamily: theme.font.display },
  primary: {
    height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary,
    alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.sm,
  },
  primaryTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
  link: { alignItems: 'center', paddingVertical: theme.spacing.lg },
  linkTxt: { color: theme.color.onSurfaceSecondary, fontSize: 14 },
  err: { color: theme.color.error, fontSize: 13, marginBottom: theme.spacing.sm },
  info: { color: theme.color.success, fontSize: 13, marginBottom: theme.spacing.sm, lineHeight: 18 },
});
