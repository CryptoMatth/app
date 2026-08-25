import { useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { theme } from '@/src/theme';
import { markOnboardingSeen } from '@/src/tutorial';

type Slide = {
  icon: keyof typeof Feather.glyphMap;
  color: string;
  bg: string;
  title: string;
  body: string;
  bullets?: string[];
};

const SLIDES: Slide[] = [
  {
    icon: 'coffee',
    color: theme.color.brandPrimary,
    bg: theme.color.brandTertiary,
    title: 'Benvenuto in PlanEat 🍽️',
    body: 'Organizza pasti e spesa della settimana in un\'unica app, senza più liste sparse tra frigo e messaggi.',
    bullets: [
      'Salva i tuoi piatti preferiti',
      'Pianifica la settimana in un tocco',
      'La lista spesa si compila da sola',
    ],
  },
  {
    icon: 'book-open',
    color: theme.color.brandPrimary,
    bg: theme.color.brandTertiary,
    title: 'Piatti · il tuo ricettario',
    body: 'Crea le tue ricette una sola volta. Puoi separarle in Primi e Secondi, aggiungere ingredienti con quantità, preparazione e note.',
    bullets: [
      'Tocca "Nuovo piatto" per iniziare',
      'Duplica una ricetta simile per andare veloce',
      'Cerca velocemente dalla barra di ricerca',
    ],
  },
  {
    icon: 'calendar',
    color: theme.color.brandSecondary,
    bg: '#E5EDDF',
    title: 'Planner · la settimana',
    body: 'Sette giorni (sabato → venerdì) con Pranzo e Cena. Tocca uno slot per assegnare un piatto e indicare per quante persone.',
    bullets: [
      'La spesa si aggiorna automaticamente',
      'Usa "Oggi" per tornare alla settimana corrente',
      'Duplica una settimana passata con l\'icona 📋',
    ],
  },
  {
    icon: 'shopping-cart',
    color: theme.color.brand,
    bg: '#F5E8D8',
    title: 'Spesa · sempre pronta',
    body: 'La lista si compila da sola dal Planner. Puoi anche aggiungere elementi extra a mano.',
    bullets: [
      '🟢 Verdi = dal Planner  ·  🟠 Arancioni = manuali',
      'Trascina per riordinare, spunta al supermercato',
      'Tocca "Rimuovi presi" a fine spesa',
    ],
  },
  {
    icon: 'shield',
    color: theme.color.brandSecondary,
    bg: '#E5EDDF',
    title: 'Un ultimo consiglio',
    body: 'Nei tuoi Codici di Recupero hai la chiave per rientrare se dimentichi la password. Salvali in un posto sicuro dalla schermata Impostazioni.',
    bullets: [
      'Trovi tutto in Impostazioni ⚙️',
      'Puoi anche esportare un backup dei tuoi dati',
      'Rivedi questo tutorial in qualsiasi momento',
    ],
  },
];

export default function Tutorial() {
  const router = useRouter();
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
            <Text style={styles.skipTxt}>Salta</Text>
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
        {SLIDES.map((s, i) => (
          <View key={i} style={[styles.slide, { width }]} testID={`tutorial-slide-${i}`}>
            <View style={[styles.iconWrap, { backgroundColor: s.bg }]}>
              <Feather name={s.icon} size={54} color={s.color} />
            </View>
            <Text style={styles.title}>{s.title}</Text>
            <Text style={styles.body}>{s.body}</Text>
            {s.bullets?.length ? (
              <View style={styles.bullets}>
                {s.bullets.map((b, j) => (
                  <View key={j} style={styles.bulletRow}>
                    <View style={[styles.bulletDot, { backgroundColor: s.color }]} />
                    <Text style={styles.bulletTxt}>{b}</Text>
                  </View>
                ))}
              </View>
            ) : null}
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
            <Text style={styles.primaryTxt}>Inizia ad usare PlanEat</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </Pressable>
        ) : (
          <Pressable onPress={() => goTo(index + 1)} style={styles.primaryBtn} testID="tutorial-next">
            <Text style={styles.primaryTxt}>Avanti</Text>
            <Feather name="chevron-right" size={20} color="#fff" />
          </Pressable>
        )}

        <View style={styles.navBtn} />
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
    padding: theme.spacing.xl, alignItems: 'center', justifyContent: 'flex-start',
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
  navBtnDisabled: { opacity: 0.4 },
  primaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.brandPrimary,
    paddingHorizontal: theme.spacing.md,
  },
  primaryTxt: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
