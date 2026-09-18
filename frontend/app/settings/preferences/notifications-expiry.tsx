import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Platform, Alert,
} from 'react-native';
import Feather from '@react-native-vector-icons/feather';
import * as Haptics from 'expo-haptics';
import { useAuth, NotificationPrefs } from '@/src/auth';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { useTranslation } from '@/src/i18n';
import { PrefsScreenShell } from '@/src/PrefsScreenShell';
import { useHasTier, ProUpsellModal } from '@/src/ProGate';
import { fireTestNotification } from '@/src/notifications';

const DEFAULT: NotificationPrefs = {
  enabled: false, expiry_enabled: false,
  expiry_days_ahead: 1, days_ahead: [1], notify_hour: 9,
  freezer_enabled: false, freezer_hours: 24,
};

// Resolve current expiry_enabled with backward-compat fallback to legacy `enabled`.
const isExpiryOn = (n: NotificationPrefs) =>
  typeof n.expiry_enabled === 'boolean' ? n.expiry_enabled : !!n.enabled;

export default function NotificationsExpiryPreference() {
  const { t } = useTranslation();
  const { prefs, updatePreferences } = useAuth();
  const isProPlus = useHasTier('pro_plus');
  const [upsell, setUpsell] = useState(false);
  const initial = prefs.notifications || DEFAULT;
  const [notif, setNotif] = useState<NotificationPrefs>(initial);
  useEffect(() => setNotif(prefs.notifications || DEFAULT), [prefs.notifications]);

  const dirty = useMemo(() => {
    const a = { expiry_enabled: isExpiryOn(notif), days_ahead: notif.days_ahead || [], expiry_days_ahead: notif.expiry_days_ahead, notify_hour: notif.notify_hour };
    const b = { expiry_enabled: isExpiryOn(initial), days_ahead: initial.days_ahead || [], expiry_days_ahead: initial.expiry_days_ahead, notify_hour: initial.notify_hour };
    return JSON.stringify(a) !== JSON.stringify(b);
  }, [notif, initial]);

  const canEdit = isProPlus && isExpiryOn(notif);

  return (
    <PrefsScreenShell
      title={t('notif.expiry.h')}
      dirty={dirty && isProPlus}
      onSave={() => updatePreferences({
        notifications: {
          ...notif,
          // Keep the legacy master `enabled` as OR of both sub-switches so
          // older clients still see notifications as "on" if either is on.
          enabled: isExpiryOn(notif) || !!notif.freezer_enabled,
          expiry_enabled: isExpiryOn(notif),
        },
      })}
      testID="prefs-notif-expiry"
    >
      <View style={s.section}>
        <Text style={s.sectionSub}>{t('notif.expiry.sub')}</Text>

        {/* Independent enable toggle for EXPIRY alerts */}
        <View style={styles.masterCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.masterH}>{t('notif.expiry.enableH')}</Text>
            <Text style={styles.masterSub}>{t('notif.expiry.enableSub')}</Text>
          </View>
          <Pressable
            onPress={() => {
              if (!isProPlus) { setUpsell(true); return; }
              Haptics.selectionAsync();
              setNotif(n => ({ ...n, expiry_enabled: !isExpiryOn(n) }));
            }}
            style={[styles.switch, isExpiryOn(notif) && isProPlus && styles.switchOn]}
            testID="notif-expiry-master"
          >
            <View style={[styles.thumb, isExpiryOn(notif) && isProPlus && styles.thumbOn]} />
          </Pressable>
        </View>

        <View style={{ opacity: canEdit ? 1 : 0.45 }} pointerEvents={canEdit ? 'auto' : 'none'}>
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Feather name="clock" size={14} color={theme.color.brand} />
              <Text style={styles.cardH}>{t('notif.daysAhead.h')}</Text>
            </View>
            <Text style={styles.rowSub}>{t('notif.daysAhead.sub')}</Text>
            <View style={styles.chipsRow}>
              {[3, 2, 1, 0].map(d => {
                const active = (notif.days_ahead || [notif.expiry_days_ahead]).includes(d);
                return (
                  <Pressable
                    key={d}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setNotif(n => {
                        const cur = new Set(n.days_ahead || [n.expiry_days_ahead]);
                        if (cur.has(d)) cur.delete(d); else cur.add(d);
                        if (cur.size === 0) cur.add(1);
                        const arr = Array.from(cur).sort((a, b) => b - a);
                        return { ...n, days_ahead: arr, expiry_days_ahead: arr[0] };
                      });
                    }}
                    style={[styles.chip, active && styles.chipActive]}
                    testID={`notif-days-${d}`}
                  >
                    <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>
                      {d === 0 ? t('common.today') : `${d}g`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Feather name="bell" size={14} color={theme.color.brand} />
              <Text style={styles.cardH}>{t('notif.timeH')}</Text>
            </View>
            <Text style={styles.rowSub}>{t('notif.timeSub')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TextInput
                value={String(notif.notify_hour)}
                onChangeText={(text) => {
                  const v = parseInt(text.replace(/[^0-9]/g, ''));
                  setNotif(n => ({ ...n, notify_hour: isNaN(v) ? 0 : Math.max(0, Math.min(23, v)) }));
                }}
                keyboardType="numeric"
                maxLength={2}
                style={[s.input, { width: 78, textAlign: 'center', fontSize: 18, fontWeight: '600' }]}
                testID="notif-hour-input"
              />
              <Text style={{ fontSize: 15, color: theme.color.onSurfaceSecondary }}>:00</Text>
              <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[7, 9, 12, 18, 20].map(h => {
                  const active = notif.notify_hour === h;
                  return (
                    <Pressable
                      key={h}
                      onPress={() => { Haptics.selectionAsync(); setNotif(n => ({ ...n, notify_hour: h })); }}
                      style={[styles.chipSmall, active && styles.chipActive]}
                      testID={`notif-hour-${h}`}
                    >
                      <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{h}h</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        </View>

        {Platform.OS === 'web' && isExpiryOn(notif) && (
          <View style={styles.warn}>
            <Feather name="info" size={12} color={theme.color.brand} />
            <Text style={styles.warnTxt}>{t('notif.nativeOnly')}</Text>
          </View>
        )}

        {/* Test-notification button — helps user verify permissions/channel work */}
        {Platform.OS !== 'web' && isProPlus && (
          <Pressable
            onPress={async () => {
              Haptics.selectionAsync();
              const ok = await fireTestNotification();
              if (!ok) {
                Alert.alert(t('notif.test.failTitle'), t('notif.test.failBody'));
              }
            }}
            style={styles.testBtn}
            testID="notif-test-btn"
          >
            <Feather name="bell" size={14} color={theme.color.brandPrimary} />
            <Text style={styles.testBtnTxt}>{t('notif.test.cta')}</Text>
          </Pressable>
        )}
      </View>
      <ProUpsellModal open={upsell} onClose={() => setUpsell(false)} feature="notifications" />
    </PrefsScreenShell>
  );
}

const styles = StyleSheet.create({
  masterCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.color.brandTertiary,
    borderWidth: 1, borderColor: theme.color.brandPrimary,
    marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm,
  },
  masterH: { fontSize: 14, fontWeight: '700', color: theme.color.brandPrimary },
  masterSub: { fontSize: 11, color: theme.color.onSurfaceSecondary, marginTop: 2, lineHeight: 15 },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: theme.color.borderStrong, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: theme.color.brandPrimary },
  thumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  thumbOn: { alignSelf: 'flex-end' },
  card: {
    padding: theme.spacing.md, borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSecondary,
    borderWidth: 1, borderColor: theme.color.border,
    marginTop: theme.spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  cardH: { fontSize: 13, fontWeight: '600', color: theme.color.onSurface },
  rowSub: { fontSize: 11, color: theme.color.onSurfaceSecondary, lineHeight: 15, marginTop: 2, marginBottom: 8 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.pill, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  chipSmall: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: theme.radius.pill, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  chipActive: { backgroundColor: theme.color.brandTertiary, borderColor: theme.color.brandPrimary },
  chipTxt: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  chipTxtActive: { color: theme.color.brandPrimary, fontWeight: '600' },
  warn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: theme.spacing.sm, padding: 10,
    backgroundColor: '#FDE2CE', borderRadius: theme.radius.md,
  },
  warnTxt: { flex: 1, fontSize: 11, color: theme.color.brand, fontStyle: 'italic' },
  testBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: theme.spacing.lg, paddingVertical: 12,
    borderRadius: theme.radius.md, borderWidth: 1, borderStyle: 'dashed',
    borderColor: theme.color.brandPrimary,
    alignSelf: 'center', paddingHorizontal: 20,
  },
  testBtnTxt: { color: theme.color.brandPrimary, fontWeight: '600', fontSize: 13 },
});
