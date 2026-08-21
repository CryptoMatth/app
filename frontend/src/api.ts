import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
export const BACKEND_URL = API_URL;

const TOKEN_KEY = 'cdc_session_token';

async function getStore(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}
async function setStore(key: string, value: string) {
  if (Platform.OS === 'web') return AsyncStorage.setItem(key, value);
  return SecureStore.setItemAsync(key, value);
}
async function delStore(key: string) {
  if (Platform.OS === 'web') return AsyncStorage.removeItem(key);
  return SecureStore.deleteItemAsync(key);
}

let cachedToken: string | null = null;

export async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  const t = await getStore(TOKEN_KEY);
  cachedToken = t;
  return t;
}
export async function setToken(token: string) {
  cachedToken = token;
  await setStore(TOKEN_KEY, token);
}
export async function clearToken() {
  cachedToken = null;
  await delStore(TOKEN_KEY);
}

async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api${path}`, { ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data as T;
}

export const api = {
  register: (email: string, password: string, name?: string) =>
    req('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
  login: (email: string, password: string) =>
    req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  googleSession: (session_id: string) =>
    req('/auth/session', { method: 'POST', body: JSON.stringify({ session_id }) }),
  me: () => req('/auth/me'),
  logout: () => req('/auth/logout', { method: 'POST' }),

  listDishes: (params?: { course?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.course) qs.set('course', params.course);
    if (params?.q) qs.set('q', params.q);
    const s = qs.toString();
    return req(`/dishes${s ? `?${s}` : ''}`);
  },
  getDish: (id: string) => req(`/dishes/${id}`),
  createDish: (data: any) => req('/dishes', { method: 'POST', body: JSON.stringify(data) }),
  updateDish: (id: string, data: any) => req(`/dishes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDish: (id: string) => req(`/dishes/${id}`, { method: 'DELETE' }),
  duplicateDish: (id: string) => req(`/dishes/${id}/duplicate`, { method: 'POST' }),

  getPlanner: (weekStart: string) => req(`/planner/${weekStart}`),
  updateSlot: (data: any) => req('/planner/slot', { method: 'PUT', body: JSON.stringify(data) }),
  duplicateWeek: (source: string, target: string) =>
    req('/planner/duplicate', {
      method: 'POST',
      body: JSON.stringify({ source_week_start: source, target_week_start: target }),
    }),

  listShopping: () => req('/shopping'),
  addManual: (name: string, quantity: number, unit: string) =>
    req('/shopping', { method: 'POST', body: JSON.stringify({ name, quantity, unit }) }),
  toggleShopping: (id: string, checked: boolean) =>
    req(`/shopping/${id}/toggle`, { method: 'PATCH', body: JSON.stringify({ checked }) }),
  deleteShopping: (id: string) => req(`/shopping/${id}`, { method: 'DELETE' }),
  forceDeleteShopping: (id: string) => req(`/shopping/${id}/force`, { method: 'DELETE' }),
  reorderShopping: (ordered_ids: string[]) =>
    req('/shopping/reorder', { method: 'POST', body: JSON.stringify({ ordered_ids }) }),
  clearChecked: () => req('/shopping/clear-checked', { method: 'POST' }),
};
