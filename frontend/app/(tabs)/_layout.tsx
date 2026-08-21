import { Tabs, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useEffect } from 'react';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';

export default function TabsLayout() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/(auth)/login');
  }, [user, loading, router]);

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
