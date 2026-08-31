import { Tabs, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { hasSeenOnboarding } from '@/src/tutorial';
import { useTranslation } from '@/src/i18n';
import { api } from '@/src/api';
import { reschedule, readNotifPrefs, type PlannedMeal, type ShoppingItemLite } from '@/src/notifications';
import { parseIso, addDays } from '@/src/week';

export default function TabsLayout() {
  const { user, loading, prefs } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const [checked, setChecked] = useState(false);

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
  // We refetch shopping + planner + dishes once and let the notifications
  // module cancel & re-create everything.
  useEffect(() => {
    if (loading || !user || !user.is_pro) return;
    const np = readNotifPrefs(prefs);
    if (!np.enabled) { void reschedule([], [], np); return; }
    let cancelled = false;
    (async () => {
      try {
        const [items, weeks, dishes] = await Promise.all([
          api.listShopping(),
          api.listPlannerWeeks(),
          api.listDishes(),
        ]);
        if (cancelled) return;
        const dishById: Record<string, any> = {};
        for (const d of dishes) dishById[d.id] = d;
        const plans: PlannedMeal[] = [];
        // Fetch plan slots for each future/current week
        for (const w of weeks) {
          const wDate = parseIso(w.week_start);
          const end = addDays(wDate, 6);
          if (end.getTime() < Date.now() - 24 * 3600 * 1000) continue;
          try {
            const plan = await api.getPlanner(w.week_start);
            if (cancelled) return;
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
        await reschedule(items as ShoppingItemLite[], plans, np);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [loading, user, prefs]);

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
          height: 62,
          paddingBottom: 8,
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
    </Tabs>
  );
}
