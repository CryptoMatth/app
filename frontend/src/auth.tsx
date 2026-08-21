import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, clearToken, setToken, getToken } from './api';

export type User = { user_id: string; email: string; name: string; picture?: string | null };

type AuthCtx = {
  user: User | null;
  loading: boolean;
  loginEmail: (email: string, pw: string) => Promise<void>;
  register: (email: string, pw: string, name?: string) => Promise<void>;
  loginWithGoogleSession: (session_id: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  resetPassword: (email: string, code: string, new_password: string) => Promise<void>;
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

  const loginEmail = async (email: string, pw: string) => {
    const res = await api.login(email, pw);
    await setToken(res.session_token);
    setUser(res.user);
  };
  const register = async (email: string, pw: string, name?: string) => {
    const res = await api.register(email, pw, name);
    await setToken(res.session_token);
    setUser(res.user);
  };
  const loginWithGoogleSession = async (session_id: string) => {
    const res = await api.googleSession(session_id);
    await setToken(res.session_token);
    setUser(res.user);
  };
  const logout = async () => {
    try { await api.logout(); } catch {}
    await clearToken();
    setUser(null);
  };
  const refresh = async () => {
    try { const u = await api.me(); setUser(u); } catch { setUser(null); }
  };
  const resetPassword = async (email: string, code: string, new_password: string) => {
    const res = await api.resetPassword(email, code, new_password);
    await setToken(res.session_token);
    setUser(res.user);
  };

  return (
    <Ctx.Provider value={{ user, loading, loginEmail, register, loginWithGoogleSession, logout, refresh, resetPassword }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used within AuthProvider');
  return c;
}
