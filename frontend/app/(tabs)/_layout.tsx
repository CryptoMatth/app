import { Tabs, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';
import { hasSeenOnboarding } from '@/src/tutorial';

export default function TabsLayout() {
  const { user, loading } = useAuth();
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
          title: 'Piatti',
          tabBarIcon: ({ color, size }) => <Feather name="book-open" size={size} color={color} />,
          tabBarButtonTestID: 'tab-piatti',
        }}
      />
      <Tabs.Screen
        name="planner"
        options={{
          title: 'Planner',
          tabBarIcon: ({ color, size }) => <Feather name="calendar" size={size} color={color} />,
          tabBarButtonTestID: 'tab-planner',
        }}
      />
      <Tabs.Screen
        name="spesa"
        options={{
          title: 'Spesa',
          tabBarIcon: ({ color, size }) => <Feather name="shopping-cart" size={size} color={color} />,
          tabBarButtonTestID: 'tab-spesa',
        }}
      />
    </Tabs>
  );
}
