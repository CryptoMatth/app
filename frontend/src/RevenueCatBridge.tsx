/**
 * Bridges the AuthProvider to the RevenueCat SDK.
 *
 * - configure() runs exactly once at mount (guarded internally by the wrapper).
 * - logIn() runs whenever the authenticated user changes so purchases attach
 *   to the correct FastAPI user_id.
 *
 * Renders nothing.
 */
import { useEffect, useRef } from 'react';
import { useAuth } from './auth';
import { configureRevenueCat, identifyRevenueCat, isRevenueCatConfigured } from './purchases/revenueCat';

export function RevenueCatBridge() {
  const { user } = useAuth();
  const configuredRef = useRef(false);

  useEffect(() => {
    if (configuredRef.current) return;
    if (!isRevenueCatConfigured()) return;
    configureRevenueCat(user?.user_id ?? null);
    configuredRef.current = true;
  }, [user?.user_id]);

  useEffect(() => {
    if (!configuredRef.current) return;
    if (!user?.user_id) return;
    identifyRevenueCat(user.user_id);
  }, [user?.user_id]);

  return null;
}
