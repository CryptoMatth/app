import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@react-native-vector-icons/feather';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { api } from '@/src/api';
import { theme } from '@/src/theme';
import { useTranslation } from '@/src/i18n';
import { PhotoThumb } from '@/src/PhotoPicker';

type Notification = {
  id: string;
  kind: 'expiry';
  fridge_item_id: string;
  item_name: string;
  item_photo_path?: string | null;
  category_id?: string;
  date: string;
  label: string;
  days_until: number;
  read: boolean;
  created_at: string;
};

export default function NotificationsScreen() {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.listNotifications();
      setNotifs(r?.notifications || []);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleRead = async (n: Notification) => {
    Haptics.selectionAsync();
    // Optimistic
    setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read: !x.read } : x));
    try {
      if (n.read) await api.markNotificationsUnread([n.id]);
      else await api.markNotificationsRead([n.id]);
    } catch {}
  };

  const del = async (n: Notification) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNotifs(prev => prev.filter(x => x.id !== n.id));
    try { await api.deleteNotifications([n.id]); } catch {}
  };

  const markAll = async () => {
    setBusy(true);
    try {
      await api.markAllNotificationsRead();
      setNotifs(prev => prev.map(x => ({ ...x, read: true })));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}
    setBusy(false);
  };

  const formatWhen = (n: Notification) => {
    if (n.days_until < 0) return t('expiry.expired', { n: -n.days_until });
    if (n.days_until === 0) return t('expiry.today');
    if (n.days_until === 1) return t('expiry.tomorrow');
    return t('expiry.in', { n: n.days_until });
  };

  const renderItem = ({ item: n }: { item: Notification }) => {
    const urgent = n.days_until <= 1;
    return (
      <Pressable
        onPress={() => router.push(`/fridge/${n.fridge_item_id}`)}
        onLongPress={() => toggleRead(n)}
        style={[styles.row, !n.read && styles.rowUnread]}
        testID={`notif-row-${n.id}`}
      >
        <View style={styles.rowInner}>
          <PhotoThumb path={n.item_photo_path || null} size={40} rounded fallbackEmoji="🔔" fallbackIcon="bell" />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {!n.read && <View style={styles.unreadDot} />}
              <Text style={styles.itemName} numberOfLines={1}>{n.item_name}</Text>
            </View>
            <Text style={[styles.itemMeta, urgent && { color: theme.color.error, fontWeight: '600' }]}>
              {formatWhen(n)} · {new Date(n.date).toLocaleDateString(locale, { day: '2-digit', month: 'short' })}
              {n.label ? ` · 🏷️ ${n.label}` : ''}
            </Text>
          </View>
          <Pressable onPress={() => toggleRead(n)} hitSlop={12} style={styles.iconBtn} testID={`notif-toggle-${n.id}`}>
            <Feather name={n.read ? 'circle' : 'check-circle'} size={18} color={theme.color.onSurfaceSecondary} />
          </Pressable>
          <Pressable onPress={() => del(n)} hitSlop={12} style={styles.iconBtn} testID={`notif-delete-${n.id}`}>
            <Feather name="trash-2" size={16} color={theme.color.onSurfaceTertiary} />
          </Pressable>
        </View>
      </Pressable>
    );
  };

  const unread = notifs.filter(n => !n.read).length;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="notifications-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.hBtn} testID="notifications-back">
          <Feather name="arrow-left" size={22} color={theme.color.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>{t('notifications.header')}</Text>
          <Text style={styles.sub}>
            {unread > 0
              ? t('notifications.unread', { n: unread })
              : t('notifications.allRead')}
          </Text>
        </View>
        <Pressable
          onPress={markAll}
          style={[styles.hBtn, (unread === 0 || busy) && { opacity: 0.4 }]}
          disabled={unread === 0 || busy}
          testID="notifications-mark-all"
          hitSlop={8}
        >
          <Feather name="check-square" size={20} color={theme.color.brandPrimary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.color.brandPrimary} /></View>
      ) : notifs.length === 0 ? (
        <View style={styles.center}>
          <Feather name="bell-off" size={40} color={theme.color.borderStrong} />
          <Text style={styles.emptyH}>{t('notifications.empty.title')}</Text>
          <Text style={styles.emptyP}>{t('notifications.empty.sub')}</Text>
        </View>
      ) : (
        <FlatList
          data={notifs}
          keyExtractor={n => n.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.brandPrimary} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.color.divider,
  },
  hBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  h1: { fontFamily: theme.font.display, fontSize: 22, color: theme.color.onSurface },
  sub: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: theme.spacing.xl },
  emptyH: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface },
  emptyP: { fontSize: 13, color: theme.color.onSurfaceSecondary, textAlign: 'center', lineHeight: 18 },
  row: {
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surface,
    marginBottom: 8,
    overflow: 'hidden',
  },
  rowUnread: { borderColor: theme.color.brand, backgroundColor: theme.color.surfaceSecondary },
  rowInner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: theme.spacing.md,
  },
  itemName: { fontSize: 14, color: theme.color.onSurface, fontWeight: '600', flex: 1 },
  itemMeta: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  unreadDot: {
    width: 7, height: 7, borderRadius: 4, backgroundColor: theme.color.brand,
  },
  iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
});
