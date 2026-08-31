/**
 * Local notification scheduling for expiration + freezer alerts.
 *
 * We use LOCAL scheduled notifications (expo-notifications) — no push server
 * needed. This works out of the box on native builds; in Expo Go on iOS SDK
 * 53+ it's degraded but silent scheduling still succeeds (the OS may not
 * actually fire), so we always store the schedule intent server-side too.
 *
 * Scheduling flow:
 *   1. When shopping list or planner changes, call `reschedule(items, prefs, plan)`
 *   2. We cancel all previously-scheduled PlanEat notifications
 *   3. We schedule fresh ones based on current state
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { UserPreferences } from './auth';

export type NotifPrefs = {
  enabled: boolean;
  expiry_days_ahead: number;   // e.g. 1 = notify 1 day before
  notify_hour: number;         // 0..23, local time
  freezer_enabled: boolean;    // 24h before a planned meal with frozen ingredients
};

export const DEFAULT_NOTIF: NotifPrefs = {
  enabled: false,
  expiry_days_ahead: 1,
  notify_hour: 9,
  freezer_enabled: true,
};

const TAG = 'planeat';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowAlert: true,
  } as any),
});

export async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync();
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
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export type ShoppingItemLite = {
  id: string;
  name: string;
  expires_at?: string | null;
  category_id?: string;
  checked?: boolean;
};

export type PlannedMeal = {
  date: Date;                   // day of the meal
  meal: 'pranzo' | 'cena';
  dishes: { name: string; ingredients: { name: string; category_id?: string }[] }[];
};

const FROZEN_CATEGORY_IDS = new Set(['surgelati']);

function hasFrozen(m: PlannedMeal): boolean {
  return m.dishes.some(d => d.ingredients.some(i => FROZEN_CATEGORY_IDS.has(i.category_id || '')));
}

/** Cancel & re-schedule everything based on the given state. */
export async function reschedule(
  items: ShoppingItemLite[],
  plans: PlannedMeal[],
  prefs: NotifPrefs,
): Promise<{ scheduled: number; skipped: number }> {
  if (Platform.OS === 'web') return { scheduled: 0, skipped: 0 };
  if (!prefs.enabled) {
    await cancelAllPlanEat();
    return { scheduled: 0, skipped: 0 };
  }
  const ok = await ensurePermission();
  if (!ok) return { scheduled: 0, skipped: 0 };

  await cancelAllPlanEat();

  const now = new Date();
  const notifyHour = Math.max(0, Math.min(23, prefs.notify_hour));
  let scheduled = 0;
  let skipped = 0;

  // Expiry notifications
  for (const it of items) {
    if (it.checked || !it.expires_at) continue;
    const d = parseIso(it.expires_at);
    if (!d) continue;
    const warn = new Date(d);
    warn.setDate(warn.getDate() - prefs.expiry_days_ahead);
    warn.setHours(notifyHour, 0, 0, 0);
    if (warn.getTime() <= now.getTime()) { skipped++; continue; }
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🕐 In scadenza',
          body: `${it.name} scade tra ${prefs.expiry_days_ahead} giorn${prefs.expiry_days_ahead === 1 ? 'o' : 'i'}.`,
          data: { tag: TAG, kind: 'expiry', item_id: it.id },
        },
        trigger: { type: 'date' as any, date: warn } as any,
      });
      scheduled++;
    } catch { skipped++; }
  }

  // Freezer alerts (24h before planned meals)
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
          },
          trigger: { type: 'date' as any, date: warn } as any,
        });
        scheduled++;
      } catch { skipped++; }
    }
  }
  return { scheduled, skipped };
}

/** Handy helper: read notif prefs off the user preferences (with defaults). */
export function readNotifPrefs(prefs: UserPreferences | any): NotifPrefs {
  const n = (prefs && (prefs as any).notifications) || {};
  return {
    enabled: !!n.enabled,
    expiry_days_ahead: Number.isFinite(n.expiry_days_ahead) ? n.expiry_days_ahead : DEFAULT_NOTIF.expiry_days_ahead,
    notify_hour: Number.isFinite(n.notify_hour) ? n.notify_hour : DEFAULT_NOTIF.notify_hour,
    freezer_enabled: n.freezer_enabled ?? DEFAULT_NOTIF.freezer_enabled,
  };
}
