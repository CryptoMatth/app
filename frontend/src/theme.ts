// Warm & welcoming design theme tokens
export const theme = {
  color: {
    surface: '#FDFBF7',
    onSurface: '#3D342B',
    surfaceSecondary: '#F5F2EB',
    onSurfaceSecondary: '#5A5045',
    surfaceTertiary: '#EBE5D9',
    onSurfaceTertiary: '#6B6054',
    surfaceInverse: '#2C2826',
    onSurfaceInverse: '#FDFBF7',
    brand: '#D97757',
    brandPrimary: '#C66241',
    onBrandPrimary: '#FFFFFF',
    brandSecondary: '#7E947A',
    onBrandSecondary: '#FFFFFF',
    brandTertiary: '#E8DCC4',
    onBrandTertiary: '#5A5045',
    success: '#5E7C5A',
    warning: '#D4A373',
    error: '#B85450',
    border: '#DED5C5',
    borderStrong: '#C3B6A1',
    divider: '#EBE5D9',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
  font: {
    display: 'Georgia',
    text: 'System',
  },
  fontSize: { sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, xxxl: 30 },
};

export type Theme = typeof theme;
