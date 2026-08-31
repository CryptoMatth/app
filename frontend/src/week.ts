/**
 * Week utilities. The start-of-week day is configurable per user
 * (0 = Monday, 6 = Sunday). Historically PlanEat started on Saturday (5).
 */
import { tStatic, localeOf, type Lang } from './i18n';

// Kept for backwards compatibility (Saturday-based) — used by legacy call sites.
// These are only used when a lang isn't available; UI code should use the
// `useTranslation()`-aware helpers below.
export const DAY_LABELS = ['Sab', 'Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
export const DAY_LABELS_FULL = ['Sabato', 'Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì'];

/** Localized options for the "week start day" picker. */
export function weekStartOptions(lang: Lang | undefined) {
  const keys = ['day.mon', 'day.tue', 'day.wed', 'day.thu', 'day.fri', 'day.sat', 'day.sun'];
  return keys.map((k, i) => ({ value: i, label: tStatic(lang, k) }));
}

/** Legacy Italian-only options (kept for backwards compat where lang isn't threaded). */
export const WEEK_START_OPTIONS = weekStartOptions('it');

function labelsFor(lang: Lang | undefined, full: boolean): string[] {
  const suffix = full ? '' : '.short';
  return [
    tStatic(lang, `day.mon${suffix}`),
    tStatic(lang, `day.tue${suffix}`),
    tStatic(lang, `day.wed${suffix}`),
    tStatic(lang, `day.thu${suffix}`),
    tStatic(lang, `day.fri${suffix}`),
    tStatic(lang, `day.sat${suffix}`),
    tStatic(lang, `day.sun${suffix}`),
  ];
}

/** Return the ordered day labels (7 items) starting from `startDay` (0=Mon..6=Sun). */
export function orderedDayLabels(startDay: number, full = false, lang: Lang | undefined = 'it'): string[] {
  const src = labelsFor(lang, full);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) out.push(src[(startDay + i) % 7]);
  return out;
}

/** Given any date, return the start date of its "custom" week (Date at midnight). */
export function weekStartFor(d: Date, startDay: number): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Convert JS `getDay()` (0=Sun..6=Sat) to Monday-first (0=Mon..6=Sun)
  const dow = (c.getDay() + 6) % 7;
  const back = (dow - startDay + 7) % 7;
  c.setDate(c.getDate() - back);
  return c;
}

/** @deprecated Use `weekStartFor(d, 5)`. Kept for old imports. */
export function saturdayOf(d: Date): Date {
  return weekStartFor(d, 5);
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function weekRangeLabel(weekStart: Date, lang: Lang | undefined = 'it'): string {
  const end = addDays(weekStart, 6);
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };
  const loc = localeOf(lang);
  return `${weekStart.toLocaleDateString(loc, opts)} – ${end.toLocaleDateString(loc, opts)}`;
}

export function todayIndexInWeek(weekStart: Date): number | null {
  const today = new Date();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    if (d.getTime() === t.getTime()) return i;
  }
  return null;
}

export function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Short arrow label like "lun → dom" for the week strip subtitle. */
export function weekStartLabels(startDay: number, lang: Lang | undefined = 'it'): string {
  const short = orderedDayLabels(startDay, false, lang);
  return `${short[0].toLowerCase()} → ${short[6].toLowerCase()}`;
}
