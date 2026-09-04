/**
 * Course visual — an emoji character used as the icon on dish cards.
 *
 * Historically returned a Feather icon key; now returns a short emoji string
 * so the visual matches specific culinary categories (steaming plate, cutlet,
 * fries, cake, …). Custom user courses can pick from the same catalog.
 *
 * Callers that render this should treat the returned string as text — not as
 * a Feather glyph. The `iconForCourse` helper preserves fallback logic based
 * on both course id AND label keywords (IT + EN) so custom courses like
 * "Breakfast" still get a themed emoji.
 */

/** Full picker catalog surfaced in the Preferences category editor. */
export const COURSE_EMOJI_CATALOG: string[] = [
  '🍝', // primo — plate of pasta (steaming default)
  '🍲', // steaming stew — alt for primo/zuppa
  '🍜', // ramen — alt primo
  '🍚', // rice bowl
  '🥩', // steak — secondo
  '🍗', // roast chicken leg — secondo
  '🍖', // meat on bone
  '🍔', // burger
  '🐟', // fish
  '🍟', // fries — contorno
  '🥗', // salad — contorno
  '🥦', // broccoli
  '🥕', // carrot
  '🥔', // potato
  '🍰', // cake slice — dolce
  '🧁', // cupcake — dolce
  '🍪', // cookie
  '🍨', // ice cream
  '🥐', // croissant — colazione
  '🍳', // fried egg — colazione
  '🥞', // pancakes
  '🍞', // bread — antipasto
  '🧀', // cheese
  '🥪', // sandwich — snack
  '🍕', // pizza
  '🌮', // taco
  '☕', // coffee — bevanda
  '🍷', // wine
  '🍺', // beer
  '🥤', // drink
];

/** Map a course id → default emoji. */
export function emojiForCourse(courseId: string, label?: string): string {
  const id = (courseId || '').toLowerCase();
  const lb = (label || '').toLowerCase();
  switch (id) {
    case 'primo': case 'primi': case 'pasta': case 'zuppa': return '🍝';
    case 'secondo': case 'secondi': case 'carne': return '🥩';
    case 'pesce': return '🐟';
    case 'contorno': case 'contorni': case 'insalata': return '🍟';
    case 'verdura': return '🥗';
    case 'dolce': case 'dolci': case 'dessert': case 'torta': return '🍰';
    case 'antipasto': case 'antipasti': case 'starter': case 'appetizer': return '🍞';
    case 'colazione': case 'breakfast': case 'brunch': return '🥐';
    case 'snack': case 'spuntino': case 'merenda': return '🥪';
    case 'bevanda': case 'bevande': case 'drink': case 'drinks': return '☕';
  }
  if (lb.includes('past') || lb.includes('riso') || lb.includes('zupp')) return '🍝';
  if (lb.includes('carne') || lb.includes('meat')) return '🥩';
  if (lb.includes('pesce') || lb.includes('fish')) return '🐟';
  if (lb.includes('verd') || lb.includes('insal') || lb.includes('salad') || lb.includes('veg')) return '🥗';
  if (lb.includes('dolc') || lb.includes('torta') || lb.includes('cake') || lb.includes('dessert')) return '🍰';
  if (lb.includes('breakfast') || lb.includes('colazion') || lb.includes('brunch')) return '🥐';
  if (lb.includes('snack') || lb.includes('spuntin') || lb.includes('merend')) return '🥪';
  if (lb.includes('drink') || lb.includes('bev')) return '☕';
  if (lb.includes('antipast') || lb.includes('starter') || lb.includes('appet')) return '🍞';
  return '🍽️';
}

/**
 * Preferred: prefer the user-picked emoji stored on the course preference,
 * else fall back to the built-in mapping by id/label.
 */
export function courseEmoji(course?: { id?: string; label?: string; icon?: string | null }): string {
  const custom = (course?.icon || '').trim();
  if (custom) return custom;
  return emojiForCourse(course?.id || '', course?.label);
}
