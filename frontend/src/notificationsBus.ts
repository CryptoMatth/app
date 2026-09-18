/**
 * Lightweight event bus used to trigger a re-schedule of local notifications
 * whenever data that impacts them changes (fridge, planner, dishes).
 *
 * Any screen that mutates fridge items or planner slots should call
 * `bumpNotifications()` after the mutation succeeds. The tabs layout
 * subscribes via `useNotificationBumpValue()` and re-runs the scheduling
 * effect whenever the value changes.
 *
 * We intentionally keep this outside of React state so callers can bump from
 * anywhere (including async callbacks) without prop-drilling.
 */
import { useEffect, useState } from 'react';

type Listener = (value: number) => void;

let counter = 0;
const listeners = new Set<Listener>();

export function bumpNotifications() {
  counter += 1;
  const snapshot = counter;
  listeners.forEach(l => {
    try { l(snapshot); } catch { /* noop */ }
  });
}

export function useNotificationBumpValue(): number {
  const [value, setValue] = useState(counter);
  useEffect(() => {
    const listener: Listener = v => setValue(v);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return value;
}
