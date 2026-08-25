import { StyleSheet } from 'react-native';
import { theme } from '@/src/theme';

/**
 * Shared styles for all sub-pages under /settings/*.
 * Keeps consistent header, cards, action rows, modals.
 */
export const settingsStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1, borderBottomColor: theme.color.divider,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  h1: { flex: 1, textAlign: 'center', fontFamily: theme.font.display, fontSize: 20, color: theme.color.onSurface },
  section: { marginBottom: theme.spacing.xl },
  sectionH: { fontFamily: theme.font.display, fontSize: 16, color: theme.color.onSurface, marginBottom: theme.spacing.sm },
  sectionSub: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginBottom: theme.spacing.md, lineHeight: 18 },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.md,
    borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surface, marginBottom: theme.spacing.sm,
  },
  actionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { fontSize: 15, color: theme.color.onSurface, fontWeight: '500' },
  actionSub: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
    padding: theme.spacing.lg, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.color.border,
    backgroundColor: theme.color.surface, marginBottom: theme.spacing.sm,
  },
  input: {
    height: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border,
    paddingHorizontal: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary,
    color: theme.color.onSurface, fontSize: 15, marginBottom: theme.spacing.sm,
  },
  msgBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: theme.spacing.md, borderRadius: theme.radius.md, marginTop: theme.spacing.sm,
  },
  msgOk: { backgroundColor: '#E5EDDF' },
  msgErr: { backgroundColor: '#F5E0DC' },
  msgTxt: { flex: 1, fontSize: 13, lineHeight: 18 },
  err: { color: theme.color.error, fontSize: 13, marginTop: 4 },
  btnGhost: {
    flex: 1, height: 46, borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  btnGhostTxt: { color: theme.color.onSurface, fontWeight: '500' },
  btnPrim: {
    flex: 1, height: 46, borderRadius: theme.radius.pill,
    backgroundColor: theme.color.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDanger: {
    flex: 1, height: 46, borderRadius: theme.radius.pill,
    backgroundColor: theme.color.error,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDangerTxt: { color: '#fff', fontWeight: '600' },
  overlay: {
    flex: 1, backgroundColor: 'rgba(44,40,38,0.55)',
    alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl,
  },
  modalCard: {
    backgroundColor: theme.color.surface, borderRadius: theme.radius.lg,
    padding: theme.spacing.xl, width: '100%', maxWidth: 380,
    borderWidth: 1, borderColor: theme.color.border,
  },
  modalIcon: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: theme.color.brandTertiary,
    alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.md,
  },
  modalH: { fontFamily: theme.font.display, fontSize: 18, color: theme.color.onSurface, marginBottom: 6 },
  modalP: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 19 },
});
