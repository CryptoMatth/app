import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAuth, NotificationPrefs } from '@/src/auth';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { useTranslation } from '@/src/i18n';
import { PrefsScreenShell } from '@/src/PrefsScreenShell';
import { useHasTier, ProUpsellModal } from '@/src/ProGate';
import { readNotifPrefs } from '@/src/notifications';

const DEFAULT: NotificationPrefs = {
  enabled: false, expiry_days_ahead: 1, days_ahead: [1], notify_hour: 9,
  freezer_enabled: true, freezer_hours: 24,
};

export default function NotificationsFreezerPreference() {
  const { t } = useTranslation();
  const { prefs, updatePreferences } = useAuth();
  const isProPlus = useHasTier('pro_plus');
  const [upsell, setUpsell] = useState(false);

  // Seed the local state with the *effective* freezer value from
  // readNotifPrefs so the toggle matches what the scheduler sees.
  const buildInitial = (): NotificationPrefs => {
    const effective = readNotifPrefs(prefs);
    const raw = (prefs.notifications || {}) as NotificationPrefs;
    return {
      ...DEFAULT,
      ...raw,
      freezer_enabled: effective.freezer_enabled,
      freezer_hours: (raw.freezer_hours ?? DEFAULT.freezer_hours) as number,
    };
  };
  const initial = buildInitial();
  const [notif, setNotif] = useState<NotificationPrefs>(initial);
  useEffect(() => setNotif(buildInitial()), [prefs.notifications]);  // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => {
    const a = { freezer_enabled: notif.freezer_enabled, freezer_hours: notif.freezer_hours };
    const b = { freezer_enabled: initial.freezer_enabled, freezer_hours: initial.freezer_hours };
    return JSON.stringify(a) !== JSON.stringify(b);
  }, [notif, initial]);

  const canEdit = isProPlus && !!notif.freezer_enabled;

  return (
    <PrefsScreenShell
      title={t('notif.freezer.h')}
      dirty={dirty && isProPlus}
      onSave={() => {
        // Read effective expiry state via readNotifPrefs so we preserve
        // whatever the scheduler currently sees (legacy migration included).
        const expiryOn = readNotifPrefs(prefs).expiry_enabled;
        return updatePreferences({
          notifications: {
            ...notif,
            // Persist BOTH toggles explicitly. This decouples expiry and
            // freezer definitively — otherwise turning ON one accidentally
            // turned ON the other via the legacy `enabled` fallback.
            expiry_enabled: expiryOn,
            freezer_enabled: !!notif.freezer_enabled,
            enabled: expiryOn || !!notif.freezer_enabled,
          },
        });
      }}
      testID="prefs-notif-freezer"
    >
      <View style={s.section}>
        <Text style={s.sectionSub}>{t('notif.freezer.sub')}</Text>

        {/* Independent enable toggle for FREEZER alerts — always tappable for Pro+ */}
        <View style={styles.masterCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.masterH}>{t('notif.freezer.enableH')}</Text>
            <Text style={styles.masterSub}>{t('notif.freezer.enableSub')}</Text>
          </View>
          <Pressable
            onPress={() => {
              if (!isProPlus) { setUpsell(true); return; }
              Haptics.selectionAsync();
              setNotif(n => ({ ...n, freezer_enabled: !n.freezer_enabled }));
            }}
            style={[styles.switch, notif.freezer_enabled && isProPlus && styles.switchOn]}
            testID="notif-freezer"
          >
            <View style={[styles.thumb, notif.freezer_enabled && isProPlus && styles.thumbOn]} />
          </Pressable>
        </View>

        <View style={{ opacity: canEdit ? 1 : 0.45 }} pointerEvents={canEdit ? 'auto' : 'none'}>
          <View style={styles.card}>
            {notif.freezer_enabled && (
              <>
                <Text style={styles.rowSub}>{t('notif.freezerHoursSub')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <TextInput
                    value={String(notif.freezer_hours ?? 24)}
                    onChangeText={(text) => {
                      const v = parseInt(text.replace(/[^0-9]/g, ''));
                      setNotif(n => ({ ...n, freezer_hours: isNaN(v) ? 24 : Math.max(1, Math.min(168, v)) }));
                    }}
                    keyboardType="numeric"
                    maxLength={3}
                    style={[s.input, { width: 78, textAlign: 'center', fontSize: 18, fontWeight: '600' }]}
                    testID="freezer-hours-input"
                  />
                  <Text style={{ fontSize: 14, color: theme.color.onSurfaceSecondary }}>{t('notif.hoursSuffix')}</Text>
                  <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {[12, 24, 48, 72].map(h => {
                      const active = (notif.freezer_hours ?? 24) === h;
                      return (
                        <Pressable
                          key={h}
                          onPress={() => { Haptics.selectionAsync(); setNotif(n => ({ ...n, freezer_hours: h })); }}
                          style={[styles.chipSmall, active && styles.chipActive]}
                          testID={`freezer-hours-${h}`}
                        >
                          <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{h}h</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      </View>
      <ProUpsellModal open={upsell} onClose={() => setUpsell(false)} feature="notifications" />
    </PrefsScreenShell>
  );
}

const styles = StyleSheet.create({
  masterCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: '#E5EDDF',
    borderWidth: 1, borderColor: theme.color.brandSecondary,
    marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm,
  },
  masterH: { fontSize: 14, fontWeight: '700', color: theme.color.brandSecondary },
  masterSub: { fontSize: 11, color: theme.color.onSurfaceSecondary, marginTop: 2, lineHeight: 15 },
  card: {
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
    marginTop: theme.spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: theme.spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardH: { fontSize: 13, fontWeight: '600', color: theme.color.onSurface },
  rowSub: { fontSize: 11, color: theme.color.onSurfaceSecondary, lineHeight: 15, marginTop: 2, marginBottom: 8 },
  chipSmall: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: theme.radius.pill, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  chipActive: { backgroundColor: theme.color.brandTertiary, borderColor: theme.color.brandPrimary },
  chipTxt: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  chipTxtActive: { color: theme.color.brandPrimary, fontWeight: '600' },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: theme.color.borderStrong, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: theme.color.brandPrimary },
  thumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  thumbOn: { alignSelf: 'flex-end' },
  warn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: theme.spacing.sm, padding: 10,
    backgroundColor: '#FDE2CE', borderRadius: theme.radius.md,
  },
  warnTxt: { flex: 1, fontSize: 11, color: theme.color.brand, fontStyle: 'italic' },
});
