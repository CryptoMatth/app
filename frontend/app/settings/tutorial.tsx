import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { resetAllTutorial } from '@/src/tutorial';
import { useTranslation } from '@/src/i18n';

export default function TutorialSettings() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="settings-tutorial">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back} testID="tutorial-settings-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={s.h1}>{t('tutSet.header')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
        <Text style={s.sectionSub}>{t('tutSet.intro')}</Text>

        <Pressable
          onPress={async () => { await resetAllTutorial(); router.push('/tutorial'); }}
          style={s.actionRow}
          testID="btn-review-tutorial"
        >
          <View style={[s.actionIcon, { backgroundColor: '#E5EDDF' }]}>
            <Feather name="play-circle" size={18} color={theme.color.brandSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('tutSet.review')}</Text>
            <Text style={s.actionSub}>{t('tutSet.reviewSub')}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>

        <Pressable
          onPress={async () => { await resetAllTutorial(); router.back(); }}
          style={s.actionRow}
          testID="btn-reset-tips"
        >
          <View style={[s.actionIcon, { backgroundColor: theme.color.brandTertiary }]}>
            <Feather name="refresh-ccw" size={18} color={theme.color.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('tutSet.reset')}</Text>
            <Text style={s.actionSub}>{t('tutSet.resetSub')}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
