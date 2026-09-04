/**
 * Map a course id → a sensible Feather icon.
 *
 * The default course ids are stable slugs (`primo`, `secondo`, `contorno`, `dolce`).
 * User-created courses fall back to `common`. Provide an ordered list of
 * fallback keywords (Italian + English) so custom labels like "Antipasto",
 * "Dessert", "Breakfast" still get a themed icon.
 */
import type Feather from '@react-native-vector-icons/feather';

type FeatherIcon = keyof typeof Feather.glyphMap;

export function iconForCourse(courseId: string, label?: string): FeatherIcon {
  const id = (courseId || '').toLowerCase();
  const lb = (label || '').toLowerCase();
  // Exact stable ids first
  switch (id) {
    case 'primo':
    case 'primi':
    case 'pasta':
    case 'zuppa':
      return 'align-justify'; // pasta / noodles → stacked lines
    case 'secondo':
    case 'secondi':
    case 'carne':
    case 'pesce':
      return 'award'; // a "main dish" hero mark
    case 'contorno':
    case 'contorni':
    case 'insalata':
    case 'verdura':
      return 'feather'; // light / leafy
    case 'dolce':
    case 'dolci':
    case 'dessert':
    case 'torta':
      return 'gift'; // cake-like
    case 'antipasto':
    case 'antipasti':
    case 'starter':
    case 'appetizer':
      return 'star';
    case 'colazione':
    case 'breakfast':
    case 'brunch':
      return 'sun';
    case 'snack':
    case 'spuntino':
    case 'merenda':
      return 'circle';
    case 'bevanda':
    case 'bevande':
    case 'drink':
    case 'drinks':
      return 'droplet';
  }
  // Keyword fallbacks on the label
  if (lb.includes('past') || lb.includes('riso') || lb.includes('zupp')) return 'align-justify';
  if (lb.includes('carne') || lb.includes('pesce') || lb.includes('meat') || lb.includes('fish')) return 'award';
  if (lb.includes('verd') || lb.includes('insal') || lb.includes('salad') || lb.includes('veg')) return 'feather';
  if (lb.includes('dolc') || lb.includes('torta') || lb.includes('cake') || lb.includes('dessert')) return 'gift';
  if (lb.includes('breakfast') || lb.includes('colazion') || lb.includes('brunch')) return 'sun';
  if (lb.includes('snack') || lb.includes('spuntin') || lb.includes('merend')) return 'circle';
  if (lb.includes('drink') || lb.includes('bev')) return 'droplet';
  if (lb.includes('antipast') || lb.includes('starter') || lb.includes('appet')) return 'star';
  return 'book-open';
}
