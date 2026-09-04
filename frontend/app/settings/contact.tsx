import { View, Text, Pressable, ScrollView, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { theme } from '@/src/theme';
import { settingsStyles as s } from '@/src/settingsStyles';
import { useTranslation } from '@/src/i18n';

const CONTACT_EMAIL = 'crypto.matth719@gmail.com';

export default function ContactSettings() {
  const router = useRouter();
  const { t } = useTranslation();

  const openEmail = async (subject: string) => {
    Haptics.selectionAsync();
    const url = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert(
          t('contact.emailNotFound'),
          t('contact.writeManual', { email: CONTACT_EMAIL }),
        );
      }
    } catch {
      Alert.alert(t('common.error'), t('contact.writeManual', { email: CONTACT_EMAIL }));
    }
  };

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="settings-contact">
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back} testID="contact-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <Text style={s.h1}>{t('contact.header')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg }}>
        <View style={[s.card, { flexDirection: 'column', alignItems: 'flex-start' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <View style={{
              width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.brandTertiary,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Feather name="mail" size={20} color={theme.color.brandPrimary} />
            </View>
            <View>
              <Text style={{ fontFamily: theme.font.display, fontSize: 16, color: theme.color.onSurface }}>{t('contact.cardTitle')}</Text>
              <Text style={{ fontSize: 12, color: theme.color.onSurfaceSecondary }}>{t('contact.cardSub')}</Text>
            </View>
          </View>
          <Text style={{ fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 19, marginTop: 6 }}>
            {t('contact.cardBody')}
          </Text>
        </View>

        <Pressable onPress={() => openEmail(t('contact.emailSubject.feedback'))} style={s.actionRow} testID="btn-contact-feedback">
          <View style={[s.actionIcon, { backgroundColor: theme.color.brandTertiary }]}>
            <Feather name="message-square" size={18} color={theme.color.brandPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('contact.feedback')}</Text>
            <Text style={s.actionSub}>{t('contact.feedbackSub')}</Text>
          </View>
          <Feather name="external-link" size={18} color={theme.color.onSurfaceTertiary} />
        </Pressable>

        <Pressable onPress={() => openEmail(t('contact.emailSubject.bug'))} style={s.actionRow} testID="btn-contact-bug">
          <View style={[s.actionIcon, { backgroundColor: '#F5E0DC' }]}>
            <Feather name="alert-triangle" size={18} color={theme.color.error} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('contact.bug')}</Text>
            <Text style={s.actionSub}>{t('contact.bugSub')}</Text>
          </View>
          <Feather name="external-link" size={18} color={theme.color.onSurfaceTertiary} />
        </Pressable>

        <Pressable onPress={() => openEmail(t('contact.emailSubject.feature'))} style={s.actionRow} testID="btn-contact-feature">
          <View style={[s.actionIcon, { backgroundColor: '#E5EDDF' }]}>
            <Feather name="star" size={18} color={theme.color.brandSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('contact.feature')}</Text>
            <Text style={s.actionSub}>{t('contact.featureSub')}</Text>
          </View>
          <Feather name="external-link" size={18} color={theme.color.onSurfaceTertiary} />
        </Pressable>

        <View style={{ marginTop: theme.spacing.xl, padding: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md }}>
          <Text style={{ fontSize: 11, color: theme.color.onSurfaceTertiary, textAlign: 'center' }}>
            {CONTACT_EMAIL}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
