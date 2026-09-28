import { Tabs, useRouter } from 'expo-router';
import Feather from '@react-native-vector-icons/feather';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { hasSeenOnboarding } from '@/src/tutorial';
import { useTranslation } from '@/src/i18n';
import { api } from '@/src/api';
import { reschedule, readNotifPrefs, type PlannedMeal, type FridgeLite } from '@/src/notifications';
import { parseIso, addDays } from '@/src/week';
import { useNotificationBumpValue, bumpNotifications } from '@/src/notificationsBus';

export default function TabsLayout() {
  const { user, loading, prefs } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const bump = useNotificationBumpValue();
  const insets = useSafeAreaInsets();

  // Serialize reschedules: if a new request comes in while one is running,
  // set a "dirty" flag; when the running one finishes it will run again with
  // the latest data. This prevents the previous bug where a rapid prefs-save
  // was dropped because the guard flag was still set from a stale run.
  const runningRef = useRef(false);
  const dirtyRef = useRef(false);
  const lastFingerprintRef = useRef<string>('');

  // Fingerprint only the fields that actually influence scheduling. Wrapping
  // the whole `prefs` in the useEffect deps re-fires on ANY unrelated pref
  // change (courses, categories, week_start_day, ...) and can starve the
  // scheduler if it's already busy.
  const notifFingerprint = useMemo(() => {
    const n = (prefs as any)?.notifications || {};
    return JSON.stringify({
      enabled: !!n.enabled,
      expiry_enabled: !!n.expiry_enabled,
      freezer_enabled: !!n.freezer_enabled,
      expiry_days_ahead: n.expiry_days_ahead,
      days_ahead: n.days_ahead,
      notify_hour: n.notify_hour,
      freezer_hours: n.freezer_hours,
    });
  }, [prefs]);

  // Bump on foreground so the schedule refreshes when user comes back.
  // Throttle to 1x per 30s to avoid churning the OS scheduler on rapid
  // background/foreground toggling.
  useEffect(() => {
    let lastBumpAt = 0;
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      const now = Date.now();
      if (now - lastBumpAt < 30_000) return;
      lastBumpAt = now;
      bumpNotifications();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace('/(auth)/login');
  }, [user, loading, router]);

  // On first entry into tabs after login/register, if the user has never
  // seen the onboarding tutorial, redirect them there.
  useEffect(() => {
    if (loading || !user || checked) return;
    (async () => {
      const seen = await hasSeenOnboarding();
      setChecked(true);
      if (!seen) router.replace('/tutorial');
    })();
  }, [loading, user, checked, router]);

  // Re-schedule local notifications whenever notif prefs change (or on login).
  // We refetch fridge + planner + dishes and let the notifications module
  // cancel & re-create everything. If BOTH expiry and freezer are disabled,
  // reschedule() itself will cancel-all and bail.
  //
  // Concurrency: we use a "dirty flag" pattern. If a schedule request comes
  // in while another is running, we mark dirty; the running one will loop
  // and re-run with the *latest* data. This guarantees no rescheduling is
  // dropped due to overlap.
  useEffect(() => {
    if (loading || !user || !user.is_pro) return;
    // Skip if nothing observable changed since the last successful run.
    const fingerprint = `${notifFingerprint}|${bump}`;
    if (fingerprint === lastFingerprintRef.current && !dirtyRef.current) return;
    lastFingerprintRef.current = fingerprint;

    // If already running, mark dirty and let the running loop pick up.
    if (runningRef.current) {
      dirtyRef.current = true;
      return;
    }

    runningRef.current = true;
    (async () => {
      try {
        do {
          dirtyRef.current = false;
          const np = readNotifPrefs(prefs);
          const [fridge, weeks, dishes] = await Promise.all([
            api.listFridge().catch(() => []),
            api.listPlannerWeeks().catch(() => []),
            api.listDishes().catch(() => []),
          ]);
          const dishById: Record<string, any> = {};
          for (const d of dishes) dishById[d.id] = d;
          const plans: PlannedMeal[] = [];
          for (const w of weeks) {
            const wDate = parseIso(w.week_start);
            const end = addDays(wDate, 6);
            if (end.getTime() < Date.now() - 24 * 3600 * 1000) continue;
            try {
              const plan = await api.getPlanner(w.week_start);
              const slots = plan.slots || {};
              for (const k of Object.keys(slots)) {
                const slot = slots[k];
                const [dStr, meal] = k.split('_', 2) as [string, 'pranzo' | 'cena'];
                const dayIdx = parseInt(dStr, 10);
                const items = Array.isArray(slot.items) ? slot.items : (slot.dish_id ? [slot] : []);
                if (!items.length) continue;
                const day = addDays(wDate, dayIdx);
                plans.push({
                  date: day,
                  meal,
                  dishes: items.map((it: any) => ({
                    name: it.dish_name || '',
                    ingredients: (dishById[it.dish_id]?.ingredients || []).map((i: any) => ({
                      name: i.name, category_id: i.category_id,
                    })),
                  })),
                });
              }
            } catch {}
          }
          await reschedule(fridge as FridgeLite[], plans, np);
          // Loop if a new request came in during this iteration.
        } while (dirtyRef.current);
      } catch (err) {
        console.warn('[tabs] reschedule loop failed', err);
      } finally {
        runningRef.current = false;
      }
    })();
    // Intentionally not returning a cleanup that cancels the loop — we want
    // it to finish and settle. If prefs change mid-run, the dirty flag will
    // trigger another iteration with the newest data.
  }, [loading, user, prefs, notifFingerprint, bump]);

  if (loading || !user) return null;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.brandPrimary,
        tabBarInactiveTintColor: theme.color.onSurfaceTertiary,
        tabBarStyle: {
          backgroundColor: theme.color.surface,
          borderTopColor: theme.color.border,
          borderTopWidth: 1,
          // Respect the system gesture bar / nav buttons on Samsung + newer Android.
          height: 58 + Math.max(insets.bottom, Platform.OS === 'android' ? 8 : 0),
          paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 8 : 6),
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="piatti"
        options={{
          title: t('nav.piatti'),
          tabBarIcon: ({ color, size }) => <Feather name="book-open" size={size} color={color} />,
          tabBarButtonTestID: 'tab-piatti',
        }}
      />
      <Tabs.Screen
        name="planner"
        options={{
          title: t('nav.planner'),
          tabBarIcon: ({ color, size }) => <Feather name="calendar" size={size} color={color} />,
          tabBarButtonTestID: 'tab-planner',
        }}
      />
      <Tabs.Screen
        name="spesa"
        options={{
          title: t('nav.spesa'),
          tabBarIcon: ({ color, size }) => <Feather name="shopping-cart" size={size} color={color} />,
          tabBarButtonTestID: 'tab-spesa',
        }}
      />
      <Tabs.Screen
        name="frigorifero"
        options={{
          title: t('nav.frigorifero'),
          tabBarIcon: ({ color, size }) => <Feather name="package" size={size} color={color} />,
          tabBarButtonTestID: 'tab-frigorifero',
        }}
      />
    </Tabs>
  );
}
