import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { resetAllTutorial, resetTipsOnly } from '@/src/tutorial';
import { useTranslation } from '@/src/i18n';

export default function TutorialSettings() {
  const router = useRouter();
  const { t } = useTranslation();
  const [resetDone, setResetDone] = useState(false);

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
          onPress={async () => {
            try { Haptics.selectionAsync(); } catch {}
            await resetAllTutorial();
            router.push('/tutorial');
          }}
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
          onPress={async () => {
            try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
            await resetTipsOnly();
            setResetDone(true);
          }}
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

        {resetDone && (
          <View
            style={{
              marginTop: theme.spacing.lg, padding: theme.spacing.md,
              borderRadius: theme.radius.md, backgroundColor: theme.color.brandTertiary,
              flexDirection: 'row', alignItems: 'center', gap: 8,
              borderWidth: 1, borderColor: theme.color.brandSecondary,
            }}
            testID="reset-tips-feedback"
          >
            <Feather name="check-circle" size={16} color={theme.color.success} />
            <Text style={{ flex: 1, color: theme.color.onSurface, fontSize: 13 }}>
              {t('tutSet.resetDone')}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
