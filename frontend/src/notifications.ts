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

// Verbose debug logging — flip to false for production silence.
const DEBUG = true;
function log(...args: any[]) { if (DEBUG) console.log('[notifications]', ...args); }
function warn(...args: any[]) { if (DEBUG) console.warn('[notifications]', ...args); }

export type NotifPrefs = {
  enabled: boolean;               // OR of the two below — kept for legacy checks
  expiry_enabled: boolean;
  freezer_enabled: boolean;
  expiry_days_ahead: number;      // fallback / legacy
  days_ahead: number[];           // multi-select (e.g., [3, 2, 1, 0])
  notify_hour: number;
  freezer_hours: number;          // hours before a planned meal with frozen ingredients
};

export const DEFAULT_NOTIF: NotifPrefs = {
  enabled: false,
  expiry_enabled: false,
  freezer_enabled: false,
  expiry_days_ahead: 1,
  days_ahead: [1],
  notify_hour: 9,
  freezer_hours: 24,
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
    warn('channel setup failed', err);
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
  if (!cur.canAskAgain) { log('permission denied and cannot ask again'); return false; }
  const req = await Notifications.requestPermissionsAsync({
    android: {},
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return !!req.granted;
}

async function cancelAllPlanEat() {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    let cancelled = 0;
    for (const n of scheduled) {
      if ((n.content?.data as any)?.tag === TAG) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
        cancelled++;
      }
    }
    log(`cancelled ${cancelled} previously scheduled planeat notifications`);
  } catch (err) {
    warn('cancel-all failed', err);
  }
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

// Standard meal times (24h) — used as the anchor for the meal date, since
// PlannedMeal.date is a whole-day Date. We subtract freezer_hours from this
// anchor to compute the "remember to defrost" alert.
const MEAL_HOUR: Record<PlannedMeal['meal'], number> = { pranzo: 13, cena: 20 };

/**
 * Cancel & re-schedule everything based on the current state.
 * Expiry and freezer are scheduled INDEPENDENTLY.
 *
 * Android caveat: `AlarmManager` is shared with other apps and manufacturer
 * firmware sometimes drops non-priority alarms. We use HIGH importance +
 * default sound to maximise delivery odds. For alarms > 2 weeks out, some
 * OEMs (Xiaomi/Huawei) may batch or drop — nothing we can do at app-level.
 */
export async function reschedule(
  fridge: FridgeLite[],
  plans: PlannedMeal[],
  prefs: NotifPrefs,
): Promise<{ scheduled: number; skipped: number }> {
  if (Platform.OS === 'web') return { scheduled: 0, skipped: 0 };

  log('reschedule() called', {
    fridgeCount: fridge.length,
    plansCount: plans.length,
    prefs: {
      expiry_enabled: prefs.expiry_enabled,
      freezer_enabled: prefs.freezer_enabled,
      days_ahead: prefs.days_ahead,
      notify_hour: prefs.notify_hour,
      freezer_hours: prefs.freezer_hours,
    },
  });

  // If BOTH channels are off we can just cancel everything and bail.
  if (!prefs.expiry_enabled && !prefs.freezer_enabled) {
    log('both switches off — cancelling all and bailing');
    await cancelAllPlanEat();
    return { scheduled: 0, skipped: 0 };
  }

  const ok = await ensurePermission();
  if (!ok) { warn('permission not granted — nothing scheduled'); return { scheduled: 0, skipped: 0 }; }

  await ensureAndroidChannel();
  await cancelAllPlanEat();

  const now = new Date();
  const notifyHour = Math.max(0, Math.min(23, prefs.notify_hour));
  let scheduled = 0;
  let skipped = 0;

  // ---- Expiry notifications ----
  if (prefs.expiry_enabled) {
    // Multi-select: schedule ONE notification per (item, expiry, day-offset).
    // If days_ahead is empty (legacy), fall back to [expiry_days_ahead].
    const dayOffsetsRaw = (prefs.days_ahead && prefs.days_ahead.length > 0)
      ? prefs.days_ahead
      : [prefs.expiry_days_ahead];
    // Sanitize: unique, finite, non-negative integers.
    const dayOffsets = Array.from(new Set(
      dayOffsetsRaw
        .map(v => Number(v))
        .filter(v => Number.isFinite(v) && v >= 0)
        .map(v => Math.floor(v)),
    ));
    log('scheduling expiry with dayOffsets =', dayOffsets);

    for (const it of fridge) {
      for (const entry of (it.expiries || [])) {
        const d = expiryDate(entry);
        if (!d) { log('skip: unparseable expiry', it.name, entry); continue; }
        for (const daysBefore of dayOffsets) {
          const warnDate = new Date(d);
          warnDate.setDate(warnDate.getDate() - daysBefore);
          warnDate.setHours(notifyHour, 0, 0, 0);
          if (warnDate.getTime() <= now.getTime()) {
            log('skip: past date', it.name, daysBefore, warnDate.toISOString());
            skipped++;
            continue;
          }
          const label = daysBefore === 0
            ? `${it.name} scade oggi.`
            : daysBefore === 1
              ? `${it.name} scade domani.`
              : `${it.name} scade tra ${daysBefore} giorni.`;
          try {
            const id = await Notifications.scheduleNotificationAsync({
              content: {
                title: '🕐 In scadenza',
                body: label,
                data: { tag: TAG, kind: 'expiry', item_id: it.id, days_before: daysBefore },
                ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
              },
              trigger: {
                type: SchedulableTriggerInputTypes.DATE,
                date: warnDate,
                ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
              },
            });
            log('scheduled expiry', { id, item: it.name, when: warnDate.toISOString(), daysBefore });
            scheduled++;
          } catch (err) {
            warn('expiry schedule failed', it.name, err);
            skipped++;
          }
        }
      }
    }
  }

  // ---- Freezer alerts (freezer_hours before a planned meal with frozen ingredients) ----
  if (prefs.freezer_enabled) {
    // Honor the user's `freezer_hours` setting instead of the previous
    // hard-coded 24h. Also anchor the meal at its normal hour (pranzo ~ 13,
    // cena ~ 20) so subtracting hours lands on a realistic alert time.
    const freezerHours = Math.max(1, Math.min(168,
      Number.isFinite(prefs.freezer_hours) ? Math.floor(prefs.freezer_hours) : DEFAULT_NOTIF.freezer_hours,
    ));
    log('scheduling freezer with freezerHours =', freezerHours);

    for (const m of plans) {
      if (!hasFrozen(m)) continue;
      const mealAnchor = new Date(m.date);
      mealAnchor.setHours(MEAL_HOUR[m.meal] ?? 13, 0, 0, 0);
      const warnDate = new Date(mealAnchor.getTime() - freezerHours * 3600 * 1000);
      if (warnDate.getTime() <= now.getTime()) {
        log('skip freezer: past date', m.meal, warnDate.toISOString());
        skipped++;
        continue;
      }
      const dishNames = m.dishes.map(d => d.name).filter(Boolean).join(', ') || 'un piatto surgelato';
      const mealLabel = m.meal === 'pranzo' ? 'pranzo' : 'cena';
      // Nice human-readable pretext if hours >= 24
      const timeHint = freezerHours >= 24
        ? (freezerHours === 24 ? 'domani' : `tra ${Math.round(freezerHours / 24)} giorni`)
        : `tra ${freezerHours}h`;
      try {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: '❄️ Ricordati di scongelare',
            body: `${timeHint} a ${mealLabel}: ${dishNames}`,
            data: { tag: TAG, kind: 'freezer' },
            ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
          },
          trigger: {
            type: SchedulableTriggerInputTypes.DATE,
            date: warnDate,
            ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
          },
        });
        log('scheduled freezer', { id, meal: m.meal, when: warnDate.toISOString() });
        scheduled++;
      } catch (err) {
        warn('freezer schedule failed', err);
        skipped++;
      }
    }
  }

  log(`reschedule done — scheduled=${scheduled} skipped=${skipped}`);

  // Sanity check — count what actually landed in the OS queue.
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    const mine = all.filter(n => (n.content?.data as any)?.tag === TAG);
    log(`OS queue confirms ${mine.length} planeat notifications pending`);
  } catch {}

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
    freezer_hours: Number.isFinite(n.freezer_hours) ? Math.max(1, Math.min(168, Math.floor(n.freezer_hours))) : DEFAULT_NOTIF.freezer_hours,
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

/** Debug helper: returns the currently pending planeat notifications. */
export async function listPendingPlaneatNotifications(): Promise<Array<{
  id: string;
  title: string | null | undefined;
  body: string | null | undefined;
  when: string | null;
  kind: string | null;
  itemId: string | null;
  daysBefore: number | null;
}>> {
  if (Platform.OS === 'web') return [];
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return all
      .filter(n => (n.content?.data as any)?.tag === TAG)
      .map(n => {
        const trg = n.trigger as any;
        let when: string | null = null;
        if (trg?.type === 'date' && trg?.value) when = new Date(trg.value).toISOString();
        else if (trg?.date) when = new Date(trg.date).toISOString();
        else if (trg?.timestamp) when = new Date(trg.timestamp).toISOString();
        const d = (n.content?.data as any) || {};
        return {
          id: n.identifier,
          title: n.content?.title,
          body: n.content?.body,
          when,
          kind: d.kind ?? null,
          itemId: d.item_id ?? null,
          daysBefore: typeof d.days_before === 'number' ? d.days_before : null,
        };
      })
      .sort((a, b) => (a.when || '').localeCompare(b.when || ''));
  } catch (err) {
    warn('listPendingPlaneatNotifications failed', err);
    return [];
  }
}
