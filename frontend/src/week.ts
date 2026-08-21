/**
 * Week utilities: weeks run Saturday -> Friday.
 */

export const DAY_LABELS = ['Sab', 'Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
export const DAY_LABELS_FULL = ['Sabato', 'Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì'];

/** Returns the Saturday (start of the week) for a given date. */
export function saturdayOf(d: Date): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = c.getDay(); // 0=Sun..6=Sat
  // Distance back to Saturday
  const back = (dow + 1) % 7; // Sat=6 -> 0, Sun=0 -> 1, Mon=1 -> 2, ... Fri=5 -> 6
  c.setDate(c.getDate() - back);
  return c;
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
