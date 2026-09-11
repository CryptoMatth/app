import { useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { theme } from '@/src/theme';
import { markOnboardingSeen } from '@/src/tutorial';
import { useTranslation } from '@/src/i18n';

type Slide = {
  icon: keyof typeof Feather.glyphMap;
  color: string;
  bg: string;
  titleKey: string;
  bodyKey: string;
  bulletKeys?: string[];
};

const SLIDES: Slide[] = [
  {
    icon: 'coffee',
    color: theme.color.brandPrimary,
    bg: theme.color.brandTertiary,
    titleKey: 'tut.s1.title',
    bodyKey: 'tut.s1.body',
    bulletKeys: ['tut.s1.b1', 'tut.s1.b2', 'tut.s1.b3'],
  },
  {
    icon: 'book-open',
    color: theme.color.brandPrimary,
    bg: theme.color.brandTertiary,
    titleKey: 'tut.s2.title',
    bodyKey: 'tut.s2.body',
    bulletKeys: ['tut.s2.b1', 'tut.s2.b2', 'tut.s2.b3'],
  },
  {
    icon: 'calendar',
    color: theme.color.brandSecondary,
    bg: '#E5EDDF',
    titleKey: 'tut.s3.title',
    bodyKey: 'tut.s3.body',
    bulletKeys: ['tut.s3.b1', 'tut.s3.b2', 'tut.s3.b3'],
  },
  {
    icon: 'shopping-cart',
    color: theme.color.brand,
    bg: '#F5E8D8',
    titleKey: 'tut.s4.title',
    bodyKey: 'tut.s4.body',
    bulletKeys: ['tut.s4.b1', 'tut.s4.b2', 'tut.s4.b3'],
  },
  {
    icon: 'package',
    color: theme.color.brandSecondary,
    bg: '#E5EDDF',
    titleKey: 'tut.s6.title',
    bodyKey: 'tut.s6.body',
    bulletKeys: ['tut.s6.b1', 'tut.s6.b2', 'tut.s6.b3'],
  },
  {
    icon: 'shield',
    color: theme.color.brandSecondary,
    bg: '#E5EDDF',
    titleKey: 'tut.s5.title',
    bodyKey: 'tut.s5.body',
    bulletKeys: ['tut.s5.b1', 'tut.s5.b2', 'tut.s5.b3'],
  },
];

export default function Tutorial() {
  const router = useRouter();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const isLast = index === SLIDES.length - 1;

  const goTo = useCallback((i: number) => {
    scrollRef.current?.scrollTo({ x: i * width, animated: true });
  }, [width]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.round(x / width);
    if (i !== index) {
      setIndex(i);
      Haptics.selectionAsync();
    }
  };

  const finish = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await markOnboardingSeen();
    // Replace so back doesn't return to tutorial
    router.replace('/(tabs)/piatti');
  }, [router]);

  const skip = useCallback(async () => {
    await markOnboardingSeen();
    router.replace('/(tabs)/piatti');
  }, [router]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="tutorial-screen">
      <View style={styles.topBar}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
        {!isLast ? (
          <Pressable onPress={skip} style={styles.skipBtn} testID="tutorial-skip" hitSlop={10}>
            <Text style={styles.skipTxt}>{t('tut.skip')}</Text>
          </Pressable>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {SLIDES.map((sl, i) => (
          <View key={i} style={[styles.slide, { width }]} testID={`tutorial-slide-${i}`}>
            <ScrollView
              contentContainerStyle={styles.slideInner}
              showsVerticalScrollIndicator={false}
            >
              <View style={[styles.iconWrap, { backgroundColor: sl.bg }]}>
                <Feather name={sl.icon} size={54} color={sl.color} />
              </View>
              <Text style={styles.title}>{t(sl.titleKey)}</Text>
              <Text style={styles.body}>{t(sl.bodyKey)}</Text>
              {sl.bulletKeys?.length ? (
                <View style={styles.bullets}>
                  {sl.bulletKeys.map((bk, j) => (
                    <View key={j} style={styles.bulletRow}>
                      <View style={[styles.bulletDot, { backgroundColor: sl.color }]} />
                      <Text style={styles.bulletTxt}>{t(bk)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </ScrollView>
          </View>
        ))}
      </ScrollView>

      <View style={styles.bottomBar}>
        <Pressable
          onPress={() => (index > 0 ? goTo(index - 1) : null)}
          style={[styles.navBtn, index === 0 && styles.navBtnDisabled]}
          disabled={index === 0}
          testID="tutorial-prev"
        >
          <Feather name="chevron-left" size={22} color={index === 0 ? theme.color.onSurfaceTertiary : theme.color.onSurface} />
        </Pressable>

        {isLast ? (
          <Pressable onPress={finish} style={styles.primaryBtn} testID="tutorial-finish">
            <Text style={styles.primaryTxt}>{t('tut.finish')}</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </Pressable>
        ) : (
          <Pressable onPress={() => goTo(index + 1)} style={styles.primaryBtn} testID="tutorial-next">
            <Text style={styles.primaryTxt}>{t('tut.next')}</Text>
            <Feather name="chevron-right" size={20} color="#fff" />
          </Pressable>
        )}

        <View style={styles.navBtnSpacer} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.sm,
  },
  dots: { flexDirection: 'row', gap: 6, flex: 1 },
  dot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: theme.color.border,
  },
  dotActive: { backgroundColor: theme.color.brandPrimary, width: 20 },
  skipBtn: { paddingHorizontal: theme.spacing.md, paddingVertical: 4 },
  skipTxt: { color: theme.color.onSurfaceSecondary, fontWeight: '500' },
  slide: {
    flex: 1,
  },
  slideInner: {
    padding: theme.spacing.xl, alignItems: 'center', justifyContent: 'flex-start',
    paddingBottom: theme.spacing.xxl,
  },
  iconWrap: {
    width: 140, height: 140, borderRadius: 70, alignItems: 'center', justifyContent: 'center',
    marginTop: theme.spacing.xl, marginBottom: theme.spacing.xl,
  },
  title: {
    fontFamily: theme.font.display, fontSize: 26, color: theme.color.onSurface,
    textAlign: 'center', marginBottom: theme.spacing.md,
  },
  body: {
    fontSize: 15, color: theme.color.onSurfaceSecondary, lineHeight: 22,
    textAlign: 'center', marginBottom: theme.spacing.xl, paddingHorizontal: theme.spacing.md,
  },
  bullets: { gap: 10, alignSelf: 'stretch', paddingHorizontal: theme.spacing.md },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bulletDot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  bulletTxt: { flex: 1, fontSize: 14, color: theme.color.onSurface, lineHeight: 20 },
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.md, paddingTop: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  navBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: theme.color.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border,
  },
  navBtnSpacer: { width: 46, height: 46 },
  navBtnDisabled: { opacity: 0.4 },
  primaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary,
    paddingHorizontal: theme.spacing.md,
  },
  primaryTxt: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
