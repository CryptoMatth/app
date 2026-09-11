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
  register: (username: string, password: string, password_repeat: string) =>
    req('/auth/register', { method: 'POST', body: JSON.stringify({ username, password, password_repeat }) }),
  login: (username: string, password: string) =>
    req('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => req('/auth/me'),
  logout: () => req('/auth/logout', { method: 'POST' }),
  updateUsername: (username: string, current_password: string) =>
    req('/auth/profile', { method: 'PUT', body: JSON.stringify({ username, current_password }) }),
  updatePassword: (old_password: string, new_password: string) =>
    req('/auth/password', { method: 'PUT', body: JSON.stringify({ old_password, new_password }) }),
  getPreferences: () => req('/auth/preferences'),
  updatePreferences: (data: {
    week_start_day?: number;
    planner_span?: 'weekly' | 'biweekly';
    language?: 'it' | 'en';
    courses?: { id?: string; label: string }[];
    ingredient_categories?: { id?: string; label: string; icon?: string | null; color?: string | null }[];
    notifications?: Partial<{ enabled: boolean; expiry_days_ahead: number; notify_hour: number; freezer_enabled: boolean }>;
  }) =>
    req('/auth/preferences', { method: 'PUT', body: JSON.stringify(data) }),
  recoveryVerify: (username: string, code: string, new_password: string) =>
    req('/auth/recovery/verify', { method: 'POST', body: JSON.stringify({ username, code, new_password }) }),
  recoveryRegenerate: () => req('/auth/recovery/regenerate', { method: 'POST' }),
  recoveryStatus: () => req('/auth/recovery/status'),
  deleteAccount: (password: string, confirm: string) =>
    req('/auth/delete-account', { method: 'POST', body: JSON.stringify({ password, confirm }) }),

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
  listPlannerWeeks: () => req('/planner-weeks'),
  updateSlot: (data: any) => req('/planner/slot', { method: 'PUT', body: JSON.stringify(data) }),
  duplicateWeek: (source: string, target: string) =>
    req('/planner/duplicate', {
      method: 'POST',
      body: JSON.stringify({ source_week_start: source, target_week_start: target }),
    }),

  exportData: () => req('/export'),
  importData: (payload: any) => req('/import', { method: 'POST', body: JSON.stringify(payload) }),

  // Photo upload/download (Pro feature)
  uploadPhoto: async (uri: string, contentType: string): Promise<string> => {
    const token = await getToken();
    const filename = uri.split('/').pop() || `photo.${(contentType.split('/')[1] || 'jpg')}`;

    if (Platform.OS === 'web') {
      // On web the blob() flow works reliably and is required for CORS-safe
      // uploads from a Metro dev server.
      const form = new FormData();
      const blob = await (await fetch(uri)).blob();
      const typed = blob.type ? blob : new Blob([blob], { type: contentType || 'image/jpeg' });
      form.append('file', typed, filename);
      const res = await fetch(`${API_URL}/api/upload/photo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const msg = (data && (data.detail || data.message)) || res.statusText;
        throw new Error(typeof msg === 'string' ? msg : `HTTP ${res.status}`);
      }
      return data.path as string;
    }

    // Native (iOS/Android) — React Native 0.86+ throws
    // "Unsupported FormDataPart implementation" for the legacy `{uri, name,
    // type}` FormData object, and `fetch(file://…).blob()` returns an empty
    // blob on Android. `FileSystem.uploadAsync` reads the file directly and
    // streams a proper multipart body.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require('expo-file-system/legacy');
    const result = await FileSystem.uploadAsync(`${API_URL}/api/upload/photo`, uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: contentType || 'image/jpeg',
      parameters: {},
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (result.status < 200 || result.status >= 300) {
      let detail = result.body || `HTTP ${result.status}`;
      try {
        const parsed = JSON.parse(result.body || '{}');
        detail = parsed.detail || parsed.message || detail;
      } catch {}
      throw new Error(typeof detail === 'string' ? detail : `HTTP ${result.status}`);
    }
    try {
      const parsed = JSON.parse(result.body || '{}');
      return parsed.path as string;
    } catch {
      throw new Error('Malformed upload response');
    }
  },
  signPhotoToken: async (path: string): Promise<string> => {
    const r = await req<{ token: string }>(`/files-token/${encodeURI(path)}`);
    return r.token;
  },

  listShopping: () => req('/shopping'),
  addManual: (name: string, quantity: number, unit: string, notes = '', category_id?: string, photo_path?: string | null) =>
    req('/shopping', { method: 'POST', body: JSON.stringify({ name, quantity, unit, notes, category_id, photo_path }) }),
  editShopping: (id: string, data: Partial<{ name: string; quantity: number; unit: string; notes: string; category_id: string; photo_path: string | null }>) =>
    req(`/shopping/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  toggleShopping: (id: string, checked: boolean) =>
    req(`/shopping/${id}/toggle`, { method: 'PATCH', body: JSON.stringify({ checked }) }),
  deleteShopping: (id: string) => req(`/shopping/${id}`, { method: 'DELETE' }),
  forceDeleteShopping: (id: string) => req(`/shopping/${id}/force`, { method: 'DELETE' }),
  reorderShopping: (ordered_ids: string[]) =>
    req('/shopping/reorder', { method: 'POST', body: JSON.stringify({ ordered_ids }) }),
  clearChecked: (toFridge: boolean = true) =>
    req(`/shopping/clear-checked?to_fridge=${toFridge ? 'true' : 'false'}`, { method: 'POST' }),

  // Frigorifero (Pro feature)
  listFridge: () => req('/fridge'),
  addFridge: (data: { name: string; quantity: number; unit: string; notes?: string; category_id?: string; photo_path?: string | null; expiries?: string[] }) =>
    req('/fridge', { method: 'POST', body: JSON.stringify(data) }),
  editFridge: (id: string, data: Partial<{ name: string; quantity: number; unit: string; notes: string; category_id: string; photo_path: string | null; expiries: string[] }>) =>
    req(`/fridge/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteFridge: (id: string) => req(`/fridge/${id}`, { method: 'DELETE' }),
};
