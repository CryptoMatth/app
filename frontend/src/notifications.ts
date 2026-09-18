/**
 * Local notification scheduling for expiration + freezer alerts.
 *
 * Uses expo-notifications' *local scheduled* notifications — no server push.
 * Works out of the box on native builds (APK / Play Store); Expo Go on iOS
 * SDK 53+ silently drops the scheduling call so we always try to write the
 * state and fail gracefully.
 *
 * IMPORTANT (Android 8+, 2017+): every notification MUST be delivered on a
 * registered NotificationChannel. Without a channel the OS silently discards
 * the notification. `ensureAndroidChannel()` creates the "planeat-alerts"
 * channel on first call.
 *
 * Two independent switches:
 *   - `expiry_enabled` controls scadenza notifications
 *   - `freezer_enabled` controls surgelati notifications
 * Legacy `enabled` field is kept for backwards compat and is treated as an
 * OR-mask when the new fields are undefined.
 */
import * as Notifications from 'expo-notifications';
import { AndroidImportance, SchedulableTriggerInputTypes } from 'expo-notifications';
import { Platform } from 'react-native';
import type { UserPreferences } from './auth';

export type NotifPrefs = {
  enabled: boolean;               // OR of the two below — kept for legacy checks
  expiry_enabled: boolean;
  freezer_enabled: boolean;
  expiry_days_ahead: number;      // fallback / legacy
  days_ahead: number[];           // multi-select (e.g., [3, 2, 1, 0])
  notify_hour: number;
};

export const DEFAULT_NOTIF: NotifPrefs = {
  enabled: false,
  expiry_enabled: false,
  freezer_enabled: false,
  expiry_days_ahead: 1,
  days_ahead: [1],
  notify_hour: 9,
};

const TAG = 'planeat';
const CHANNEL_ID = 'planeat-alerts';

// Android 8+ requires a notification channel. Silently no-ops on iOS/web.
async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'PlanEat',
      description: 'Avvisi scadenze e surgelati',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      enableVibrate: true,
      showBadge: false,
    });
  } catch (err) {
    // If channel setup fails we still try to schedule — some Android forks
    // (Xiaomi/MIUI) sometimes refuse channels for background apps but still
    // deliver via the default channel.
    console.warn('[notifications] channel setup failed', err);
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // Modern API (SDK 51+)
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync({
    android: {},
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return !!req.granted;
}

async function cancelAllPlanEat() {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if ((n.content?.data as any)?.tag === TAG) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
  } catch {}
}

function parseIso(s?: string | null): Date | null {
  if (!s || typeof s !== 'string') return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Normalize expiry entry to an ISO date string. Backend supports both legacy
 *  string entries ("2025-09-26") and new object form ({date, label}). */
function expiryDate(entry: unknown): Date | null {
  if (!entry) return null;
  if (typeof entry === 'string') return parseIso(entry);
  if (typeof entry === 'object' && entry !== null && 'date' in entry) {
    return parseIso((entry as any).date);
  }
  return null;
}

export type FridgeLite = {
  id: string;
  name: string;
  expiries?: (string | { date: string; label?: string })[];
  category_id?: string;
};

export type ShoppingItemLite = {
  id: string;
  name: string;
  expires_at?: string | null;
  category_id?: string;
  checked?: boolean;
};

export type PlannedMeal = {
  date: Date;
  meal: 'pranzo' | 'cena';
  dishes: { name: string; ingredients: { name: string; category_id?: string }[] }[];
};

const FROZEN_CATEGORY_IDS = new Set(['surgelati']);

function hasFrozen(m: PlannedMeal): boolean {
  return m.dishes.some(d => d.ingredients.some(i => FROZEN_CATEGORY_IDS.has(i.category_id || '')));
}

/**
 * Cancel & re-schedule everything based on the current state.
 * Expiry and freezer are scheduled INDEPENDENTLY.
 */
export async function reschedule(
  fridge: FridgeLite[],
  plans: PlannedMeal[],
  prefs: NotifPrefs,
): Promise<{ scheduled: number; skipped: number }> {
  if (Platform.OS === 'web') return { scheduled: 0, skipped: 0 };

  // If BOTH channels are off we can just cancel everything and bail.
  if (!prefs.expiry_enabled && !prefs.freezer_enabled) {
    await cancelAllPlanEat();
    return { scheduled: 0, skipped: 0 };
  }

  const ok = await ensurePermission();
  if (!ok) return { scheduled: 0, skipped: 0 };

  await ensureAndroidChannel();
  await cancelAllPlanEat();

  const now = new Date();
  const notifyHour = Math.max(0, Math.min(23, prefs.notify_hour));
  let scheduled = 0;
  let skipped = 0;

  // ---- Expiry notifications ----
  if (prefs.expiry_enabled) {
    // Multi-select: schedule ONE notification per (item, day-offset).
    // If days_ahead is empty (legacy), fall back to [expiry_days_ahead].
    const dayOffsets = (prefs.days_ahead && prefs.days_ahead.length > 0)
      ? prefs.days_ahead
      : [prefs.expiry_days_ahead];

    for (const it of fridge) {
      for (const entry of (it.expiries || [])) {
        const d = expiryDate(entry);
        if (!d) continue;
        for (const daysBefore of dayOffsets) {
          const warn = new Date(d);
          warn.setDate(warn.getDate() - daysBefore);
          warn.setHours(notifyHour, 0, 0, 0);
          if (warn.getTime() <= now.getTime()) { skipped++; continue; }
          const label = daysBefore === 0
            ? `${it.name} scade oggi.`
            : daysBefore === 1
              ? `${it.name} scade domani.`
              : `${it.name} scade tra ${daysBefore} giorni.`;
          try {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '🕐 In scadenza',
                body: label,
                data: { tag: TAG, kind: 'expiry', item_id: it.id, days_before: daysBefore },
                ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
              },
              trigger: {
                type: SchedulableTriggerInputTypes.DATE,
                date: warn,
                ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
              },
            });
            scheduled++;
          } catch (err) {
            console.warn('[notifications] expiry schedule failed', err);
            skipped++;
          }
        }
      }
    }
  }

  // ---- Freezer alerts (24h before a planned meal with frozen ingredients) ----
  if (prefs.freezer_enabled) {
    for (const m of plans) {
      if (!hasFrozen(m)) continue;
      const warn = new Date(m.date);
      warn.setDate(warn.getDate() - 1);
      warn.setHours(notifyHour, 0, 0, 0);
      if (warn.getTime() <= now.getTime()) { skipped++; continue; }
      const dishNames = m.dishes.map(d => d.name).join(', ');
      const mealLabel = m.meal === 'pranzo' ? 'pranzo' : 'cena';
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '❄️ Ricordati di scongelare',
            body: `Domani a ${mealLabel}: ${dishNames}`,
            data: { tag: TAG, kind: 'freezer' },
            ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
          },
          trigger: {
            type: SchedulableTriggerInputTypes.DATE,
            date: warn,
            ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
          },
        });
        scheduled++;
      } catch (err) {
        console.warn('[notifications] freezer schedule failed', err);
        skipped++;
      }
    }
  }

  return { scheduled, skipped };
}

/**
 * Parse notification prefs, supporting the legacy `enabled` field:
 *  - If `expiry_enabled` is undefined, fall back to `enabled`
 *  - `freezer_enabled` was always independent
 */
export function readNotifPrefs(prefs: UserPreferences | any): NotifPrefs {
  const n = (prefs && (prefs as any).notifications) || {};
  // Detect whether the record has the new per-feature schema. If EITHER
  // `expiry_enabled` or `freezer_enabled` is explicitly a boolean, we're on
  // the new schema and treat missing fields as `false`. Otherwise fall back
  // to the legacy master `enabled` field (one-time migration).
  const hasNewSchema = typeof n.expiry_enabled === 'boolean' || typeof n.freezer_enabled === 'boolean';
  const legacyOn = !!n.enabled;
  const expiry_enabled = hasNewSchema ? !!n.expiry_enabled : legacyOn;
  const freezer_enabled = hasNewSchema ? !!n.freezer_enabled : legacyOn;
  const daysAhead = Array.isArray(n.days_ahead) && n.days_ahead.length > 0
    ? n.days_ahead.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v))
    : [Number.isFinite(n.expiry_days_ahead) ? n.expiry_days_ahead : DEFAULT_NOTIF.expiry_days_ahead];
  return {
    enabled: expiry_enabled || freezer_enabled,
    expiry_enabled,
    freezer_enabled,
    expiry_days_ahead: Number.isFinite(n.expiry_days_ahead) ? n.expiry_days_ahead : daysAhead[0] ?? DEFAULT_NOTIF.expiry_days_ahead,
    days_ahead: daysAhead,
    notify_hour: Number.isFinite(n.notify_hour) ? n.notify_hour : DEFAULT_NOTIF.notify_hour,
  };
}

/** Small helper to fire a "test now" alert — useful to prove permissions/channel work. */
export async function fireTestNotification(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const ok = await ensurePermission();
  if (!ok) return false;
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🔔 Test PlanEat',
      body: 'Le notifiche funzionano correttamente!',
      data: { tag: TAG, kind: 'test' },
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: null,
  });
  return true;
}
