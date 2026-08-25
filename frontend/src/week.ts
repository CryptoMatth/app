/**
 * Week utilities. The start-of-week day is configurable per user
 * (0 = Monday, 6 = Sunday). Historically PlanEat started on Saturday (5).
 */

// Full Monday-first labels; helpers below rotate them to the configured start.
const WEEK_LABELS_FULL_MON = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const WEEK_LABELS_SHORT_MON = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

// Kept for backwards compatibility (Saturday-based) — used by legacy call sites.
export const DAY_LABELS = ['Sab', 'Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
export const DAY_LABELS_FULL = ['Sabato', 'Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì'];

export const WEEK_START_OPTIONS = [
  { value: 0, label: 'Lunedì' },
  { value: 1, label: 'Martedì' },
  { value: 2, label: 'Mercoledì' },
  { value: 3, label: 'Giovedì' },
  { value: 4, label: 'Venerdì' },
  { value: 5, label: 'Sabato' },
  { value: 6, label: 'Domenica' },
];

/** Return the ordered day labels (7 items) starting from `startDay` (0=Mon..6=Sun). */
export function orderedDayLabels(startDay: number, full = false): string[] {
  const src = full ? WEEK_LABELS_FULL_MON : WEEK_LABELS_SHORT_MON;
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

export function weekRangeLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' };
  return `${weekStart.toLocaleDateString('it-IT', opts)} – ${end.toLocaleDateString('it-IT', opts)}`;
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
export function weekStartLabels(startDay: number): string {
  const short = orderedDayLabels(startDay, false);
  return `${short[0].toLowerCase()} → ${short[6].toLowerCase()}`;
}
