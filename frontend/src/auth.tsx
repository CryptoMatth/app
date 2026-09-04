import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api, clearToken, setToken, getToken } from './api';

export type Course = { id: string; label: string; icon?: string | null };
export type IngredientCategory = { id: string; label: string; icon?: string | null; color?: string | null };
export type PlannerSpan = 'weekly' | 'biweekly';
export type Lang = 'it' | 'en';
export type NotificationPrefs = {
  enabled: boolean;
  expiry_days_ahead: number;
  notify_hour: number;
  freezer_enabled: boolean;
};
export type BackupFrequency = 'off' | 'daily' | 'weekly' | 'monthly';
export type BackupPrefs = {
  frequency: BackupFrequency;
  last_auto_at?: string | null;
};
export type UserPreferences = {
  week_start_day: number; // 0=Mon..6=Sun
  planner_span: PlannerSpan;
  language: Lang;
  courses: Course[];
  ingredient_categories: IngredientCategory[];
  notifications?: NotificationPrefs;
  backups?: BackupPrefs;
};
export type User = {
  user_id: string;
  username: string;
  preferences?: UserPreferences;
  is_pro?: boolean;
  pro_source?: string | null;
};

const DEFAULT_PREFS: UserPreferences = {
  week_start_day: 5,
  planner_span: 'weekly',
  language: 'it',
  courses: [
    { id: 'primo', label: 'Primo' },
    { id: 'secondo', label: 'Secondo' },
    { id: 'contorno', label: 'Contorno' },
    { id: 'dolce', label: 'Dolce' },
  ],
  ingredient_categories: [
    { id: 'verdura', label: 'Verdura', icon: '🥬', color: '#7A9A65' },
    { id: 'frutta', label: 'Frutta', icon: '🍎', color: '#D66852' },
    { id: 'carne_pesce', label: 'Carne / Pesce', icon: '🥩', color: '#B14A3C' },
    { id: 'latticini', label: 'Latticini', icon: '🥛', color: '#E8D4A3' },
    { id: 'pane_farinacei', label: 'Pane / Farinacei', icon: '🍞', color: '#C9975C' },
    { id: 'surgelati', label: 'Surgelati', icon: '❄️', color: '#7BB0C8' },
    { id: 'bevande', label: 'Bevande', icon: '🥤', color: '#8E7CC3' },
    { id: 'dispensa', label: 'Dispensa', icon: '🫙', color: '#A38963' },
    { id: 'altro', label: 'Altro', icon: '📦', color: '#8C8478' },
  ],
  notifications: { enabled: false, expiry_days_ahead: 1, notify_hour: 9, freezer_enabled: true },
  backups: { frequency: 'off', last_auto_at: null },
};

type AuthCtx = {
  user: User | null;
  loading: boolean;
  prefs: UserPreferences;
  token: string | null;
  loginUsername: (username: string, pw: string) => Promise<void>;
  register: (username: string, pw: string, pw2: string) => Promise<string[]>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateUsername: (username: string, current_password: string) => Promise<void>;
  updatePassword: (old_password: string, new_password: string) => Promise<void>;
  recoveryVerify: (username: string, code: string, new_password: string) => Promise<void>;
  updatePreferences: (data: Partial<UserPreferences>) => Promise<UserPreferences>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setTokenState] = useState<string | null>(null);
  const autoBackupTriggered = useRef(false);

  const bootstrap = useCallback(async () => {
    try {
      const t = await getToken();
      setTokenState(t);
      if (!t) { setUser(null); return; }
      const u = await api.me();
      setUser(u);
    } catch {
      await clearToken();
      setTokenState(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const loginUsername = async (username: string, pw: string) => {
    const res = await api.login(username, pw);
    await setToken(res.session_token);
    setTokenState(res.session_token);
    setUser(res.user);
  };
  const register = async (username: string, pw: string, pw2: string) => {
    const res = await api.register(username, pw, pw2);
    await setToken(res.session_token);
    setTokenState(res.session_token);
    setUser(res.user);
    return (res.recovery_codes || []) as string[];
  };
  const logout = async () => {
    try { await api.logout(); } catch {}
    await clearToken();
    setTokenState(null);
    setUser(null);
    autoBackupTriggered.current = false;
  };
  const refresh = async () => {
    try { const u = await api.me(); setUser(u); } catch { setUser(null); }
  };
  const updateUsername = async (username: string, current_password: string) => {
    const res = await api.updateUsername(username, current_password);
    setUser(res.user);
  };
  const updatePassword = async (old_password: string, new_password: string) => {
    await api.updatePassword(old_password, new_password);
  };
  const recoveryVerify = async (username: string, code: string, new_password: string) => {
    const res = await api.recoveryVerify(username, code, new_password);
    await setToken(res.session_token);
    setTokenState(res.session_token);
    setUser(res.user);
  };
  const updatePreferences = async (data: Partial<UserPreferences>) => {
    const updated: UserPreferences = await api.updatePreferences(data as any);
    setUser(prev => (prev ? { ...prev, preferences: updated } : prev));
    return updated;
  };

  const prefs: UserPreferences = user?.preferences || DEFAULT_PREFS;

  // Auto-backup trigger: on session start (once per app open), if the user
  // is Ultra AND has enabled a backup frequency, ping /backups/auto-check
  // so the server creates a new snapshot when due. Silent — failures are
  // swallowed to avoid disrupting normal usage.
  useEffect(() => {
    if (!user || autoBackupTriggered.current) return;
    const isUltra = (user as any).tier === 'ultra';
    const freq = user?.preferences?.backups?.frequency;
    if (!isUltra || !freq || freq === 'off') return;
    autoBackupTriggered.current = true;
    (async () => {
      try { await (api as any).autoCheckBackup(); } catch {}
    })();
  }, [user]);

  return (
    <Ctx.Provider
      value={{
        user, loading, prefs, token,
        loginUsername, register, logout, refresh,
        updateUsername, updatePassword, recoveryVerify,
        updatePreferences,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used within AuthProvider');
  return c;
}
