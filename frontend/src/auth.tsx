import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, clearToken, setToken, getToken } from './api';

export type Course = { id: string; label: string };
export type PlannerSpan = 'weekly' | 'biweekly';
export type UserPreferences = {
  week_start_day: number; // 0=Mon..6=Sun
  planner_span: PlannerSpan;
  courses: Course[];
};
export type User = {
  user_id: string;
  username: string;
  preferences?: UserPreferences;
};

const DEFAULT_PREFS: UserPreferences = {
  week_start_day: 5,
  planner_span: 'weekly',
  courses: [
    { id: 'primo', label: 'Primo' },
    { id: 'secondo', label: 'Secondo' },
    { id: 'contorno', label: 'Contorno' },
    { id: 'dolce', label: 'Dolce' },
  ],
};

type AuthCtx = {
  user: User | null;
  loading: boolean;
  prefs: UserPreferences;
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

  const bootstrap = useCallback(async () => {
    try {
      const t = await getToken();
      if (!t) { setUser(null); return; }
      const u = await api.me();
      setUser(u);
    } catch {
      await clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const loginUsername = async (username: string, pw: string) => {
    const res = await api.login(username, pw);
    await setToken(res.session_token);
    setUser(res.user);
  };
  const register = async (username: string, pw: string, pw2: string) => {
    const res = await api.register(username, pw, pw2);
    await setToken(res.session_token);
    setUser(res.user);
    return (res.recovery_codes || []) as string[];
  };
  const logout = async () => {
    try { await api.logout(); } catch {}
    await clearToken();
    setUser(null);
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
    setUser(res.user);
  };
  const updatePreferences = async (data: Partial<UserPreferences>) => {
    const updated: UserPreferences = await api.updatePreferences(data as any);
    setUser(prev => (prev ? { ...prev, preferences: updated } : prev));
    return updated;
  };

  const prefs: UserPreferences = user?.preferences || DEFAULT_PREFS;

  return (
    <Ctx.Provider
      value={{
        user, loading, prefs,
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
