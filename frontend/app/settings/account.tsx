import { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Modal, TextInput, Keyboard, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Feather from '@react-native-vector-icons/feather';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { PasswordInput } from '@/src/PasswordInput';
import { useTranslation } from '@/src/i18n';
import { api } from '@/src/api';

type Msg = { kind: 'ok' | 'err'; text: string } | null;

export default function AccountSettings() {
  const router = useRouter();
  const { user, updateUsername, updatePassword, logout } = useAuth();
  const { t } = useTranslation();
  const [editUsernameOpen, setEditUsernameOpen] = useState(false);
  const [editPasswordOpen, setEditPasswordOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    if (!msg) return;
    const to = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(to);
  }, [msg]);

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="settings-account">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back} testID="account-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={s.h1}>{t('account.header')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}>
        <View style={s.card}>
          <View style={{
            width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.brandTertiary,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Feather name="user" size={20} color={theme.color.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: theme.font.display, fontSize: 16, color: theme.color.onSurface }}>{user?.username}</Text>
            <Text style={{ fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 }}>{t('account.badge')}</Text>
          </View>
        </View>

        <Pressable onPress={() => setEditUsernameOpen(true)} style={s.actionRow} testID="btn-edit-username">
          <View style={[s.actionIcon, { backgroundColor: theme.color.brandTertiary }]}>
            <Feather name="edit-3" size={18} color={theme.color.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('account.editUsername')}</Text>
            <Text style={s.actionSub}>{t('account.editUsernameSub')}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>

        <Pressable onPress={() => setEditPasswordOpen(true)} style={s.actionRow} testID="btn-edit-password">
          <View style={[s.actionIcon, { backgroundColor: theme.color.brandTertiary }]}>
            <Feather name="lock" size={18} color={theme.color.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('account.editPassword')}</Text>
            <Text style={s.actionSub}>{t('account.editPasswordSub')}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>

        <Pressable onPress={() => router.push('/recovery-manage')} style={s.actionRow} testID="btn-recovery-codes">
          <View style={[s.actionIcon, { backgroundColor: theme.color.brandTertiary }]}>
            <Feather name="shield" size={18} color={theme.color.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('account.recoveryCodes')}</Text>
            <Text style={s.actionSub}>{t('account.recoveryCodesSub')}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>

        {/* Danger zone: delete account */}
        <Text style={dangerStyles.zoneLabel}>{t('account.dangerZone')}</Text>
        <Pressable onPress={() => setDeleteOpen(true)} style={dangerStyles.dangerRow} testID="btn-delete-account">
          <View style={[s.actionIcon, { backgroundColor: '#FEF2F0' }]}>
            <Feather name="trash-2" size={18} color={theme.color.error} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.actionTitle, { color: theme.color.error }]}>{t('account.delete.title')}</Text>
            <Text style={s.actionSub}>{t('account.delete.sub')}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>

        {msg ? (
          <View style={[s.msgBox, msg.kind === 'err' ? s.msgErr : s.msgOk]} testID="account-msg">
            <Feather name={msg.kind === 'err' ? 'alert-circle' : 'check-circle'} size={16}
              color={msg.kind === 'err' ? theme.color.error : theme.color.success} />
            <Text style={[s.msgTxt, { color: msg.kind === 'err' ? theme.color.error : theme.color.success }]}>{msg.text}</Text>
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      <EditUsernameModal
        open={editUsernameOpen}
        currentUsername={user?.username || ''}
        onClose={() => setEditUsernameOpen(false)}
        onSave={async (u, pw) => {
          await updateUsername(u, pw);
          setEditUsernameOpen(false);
          setMsg({ kind: 'ok', text: t('account.usernameUpdated') });
        }}
      />
      <ChangePasswordModal
        open={editPasswordOpen}
        onClose={() => setEditPasswordOpen(false)}
        onSave={async (oldPw, newPw) => {
          await updatePassword(oldPw, newPw);
          setEditPasswordOpen(false);
          setMsg({ kind: 'ok', text: t('account.passwordUpdated') });
        }}
      />
      <DeleteAccountModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirmed={async () => {
          setDeleteOpen(false);
          // Server has already wiped everything — force logout so the auth
          // context clears and the user lands back on the login screen.
          await logout();
        }}
      />
    </SafeAreaView>
  );
}

function EditUsernameModal({ open, currentUsername, onClose, onSave }: {
  open: boolean; currentUsername: string;
  onClose: () => void;
  onSave: (username: string, current_password: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (open) { setUsername(currentUsername); setPw(''); setErr(''); } }, [open, currentUsername]);

  const submit = async () => {
    Keyboard.dismiss(); setErr('');
    setBusy(true);
    try { await onSave(username.trim(), pw); } catch (e: any) { setErr(e.message || t('common.error')); }
    setBusy(false);
  };

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.modalCard} testID="edit-username-modal">
          <Text style={s.modalH}>{t('account.editUsername')}</Text>
          <Text style={s.modalP}>{t('account.editUsername.body')}</Text>
          <View style={{ height: theme.spacing.md }} />
          <TextInput
            testID="edit-username-input"
            placeholder={t('account.editUsername.ph')} placeholderTextColor={theme.color.onSurfaceTertiary}
            value={username} onChangeText={setUsername}
            autoCapitalize="none" autoCorrect={false}
            style={s.input}
          />
          <PasswordInput
            testID="edit-username-password"
            placeholder={t('account.editUsername.pwPh')}
            value={pw} onChangeText={setPw}
            style={s.input}
            toggleTestID="edit-username-password-toggle"
          />
          {err ? <Text style={s.err} testID="edit-username-error">{err}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.sm }}>
            <Pressable onPress={onClose} style={s.btnGhost} disabled={busy} testID="edit-username-cancel">
              <Text style={s.btnGhostTxt}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable onPress={submit} style={s.btnPrim} disabled={busy} testID="edit-username-save">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnDangerTxt}>{t('common.save')}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ChangePasswordModal({ open, onClose, onSave }: {
  open: boolean;
  onClose: () => void;
  onSave: (oldPw: string, newPw: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (open) { setOldPw(''); setNewPw(''); setNewPw2(''); setErr(''); } }, [open]);

  const submit = async () => {
    Keyboard.dismiss(); setErr('');
    if (newPw.length < 6) { setErr(t('account.errors.pwShort')); return; }
    if (newPw !== newPw2) { setErr(t('account.errors.pwMismatch')); return; }
    setBusy(true);
    try { await onSave(oldPw, newPw); } catch (e: any) { setErr(e.message || t('common.error')); }
    setBusy(false);
  };

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.modalCard} testID="edit-password-modal">
          <Text style={s.modalH}>{t('account.editPassword')}</Text>
          <Text style={s.modalP}>{t('account.editPassword.body')}</Text>
          <View style={{ height: theme.spacing.md }} />
          <PasswordInput testID="edit-password-old"
            placeholder={t('account.editPassword.oldPh')}
            value={oldPw} onChangeText={setOldPw}
            style={s.input}
            toggleTestID="edit-password-old-toggle" />
          <PasswordInput testID="edit-password-new"
            placeholder={t('account.editPassword.newPh')}
            value={newPw} onChangeText={setNewPw}
            style={s.input}
            toggleTestID="edit-password-new-toggle" />
          <PasswordInput testID="edit-password-new2"
            placeholder={t('account.editPassword.new2Ph')}
            value={newPw2} onChangeText={setNewPw2}
            style={s.input}
            toggleTestID="edit-password-new2-toggle" />
          {err ? <Text style={s.err} testID="edit-password-error">{err}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.sm }}>
            <Pressable onPress={onClose} style={s.btnGhost} disabled={busy} testID="edit-password-cancel">
              <Text style={s.btnGhostTxt}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable onPress={submit} style={s.btnPrim} disabled={busy} testID="edit-password-save">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnDangerTxt}>{t('common.save')}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DeleteAccountModal({ open, onClose, onConfirmed }: {
  open: boolean;
  onClose: () => void;
  onConfirmed: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const expectedConfirm = t('account.delete.confirmWord');

  useEffect(() => { if (open) { setPw(''); setConfirm(''); setErr(''); } }, [open]);

  const submit = async () => {
    Keyboard.dismiss(); setErr('');
    if (!pw) { setErr(t('account.delete.errors.password')); return; }
    if (confirm.trim().toUpperCase() !== expectedConfirm.toUpperCase()) {
      setErr(t('account.delete.errors.confirm', { word: expectedConfirm }));
      return;
    }
    setBusy(true);
    try {
      await api.deleteAccount(pw, confirm.trim());
      await onConfirmed();
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('invalid_password')) setErr(t('account.delete.errors.wrongPassword'));
      else setErr(msg || t('common.error'));
    }
    setBusy(false);
  };

  return (
    <Modal transparent visible={open} animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.modalCard} testID="delete-account-modal">
          <View style={dangerStyles.iconCircle}>
            <Feather name="alert-triangle" size={22} color={theme.color.error} />
          </View>
          <Text style={[s.modalH, { color: theme.color.error }]}>{t('account.delete.title')}</Text>
          <Text style={s.modalP}>{t('account.delete.body')}</Text>
          <View style={dangerStyles.warnBox}>
            <Feather name="info" size={14} color={theme.color.error} />
            <Text style={dangerStyles.warnTxt}>{t('account.delete.irreversible')}</Text>
          </View>
          <PasswordInput
            testID="delete-account-password"
            placeholder={t('account.delete.pwPh')}
            value={pw}
            onChangeText={setPw}
            style={s.input}
            toggleTestID="delete-account-password-toggle"
          />
          <TextInput
            testID="delete-account-confirm"
            placeholder={t('account.delete.confirmPh', { word: expectedConfirm })}
            placeholderTextColor={theme.color.onSurfaceTertiary}
            value={confirm}
            onChangeText={setConfirm}
            autoCapitalize="characters"
            autoCorrect={false}
            style={s.input}
          />
          {err ? <Text style={s.err} testID="delete-account-error">{err}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: theme.spacing.sm }}>
            <Pressable onPress={onClose} style={s.btnGhost} disabled={busy} testID="delete-account-cancel">
              <Text style={s.btnGhostTxt}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable onPress={submit} style={dangerStyles.btnDelete} disabled={busy} testID="delete-account-confirm-btn">
              {busy ? <ActivityIndicator color="#fff" /> : (
                <Text style={s.btnDangerTxt}>{t('account.delete.deleteBtn')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const dangerStyles = StyleSheet.create({
  zoneLabel: {
    fontSize: 11, fontWeight: '700', color: theme.color.onSurfaceTertiary,
    letterSpacing: 0.6, marginTop: theme.spacing.xl, marginBottom: 6, textTransform: 'uppercase',
  },
  dangerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: '#F5C7C0', backgroundColor: '#FEF9F8',
  },
  iconCircle: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#FEF2F0',
    alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md,
  },
  warnBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginTop: 6, marginBottom: theme.spacing.md,
    padding: 10, borderRadius: theme.radius.sm,
    backgroundColor: '#FEF2F0',
  },
  warnTxt: { flex: 1, fontSize: 12, color: theme.color.error, lineHeight: 17 },
  btnDelete: {
    flex: 1, height: 46, borderRadius: theme.radius.pill,
    backgroundColor: theme.color.error,
    alignItems: 'center', justifyContent: 'center',
  },
});
