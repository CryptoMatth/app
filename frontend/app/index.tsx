import { useEffect } from 'react';
import { View, Text, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/auth';
import { theme } from '@/src/theme';

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) router.replace('/(tabs)/planner');
    else router.replace('/(auth)/login');
  }, [user, loading, router]);

  return (
    <View style={styles.container} testID="app-loading">
      <Image
        source={require('@/assets/images/icon.png')}
        style={styles.icon}
        resizeMode="contain"
      />
      <Text style={styles.brand}>PlanEat</Text>
      <ActivityIndicator color={theme.color.brandPrimary} size="small" style={{ marginTop: 24 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.color.surface,
  },
  icon: { width: 140, height: 140, borderRadius: 32 },
  brand: {
    fontFamily: theme.font.display, fontSize: 36, color: theme.color.brandPrimary,
    marginTop: 20, letterSpacing: 0.5,
  },
});
