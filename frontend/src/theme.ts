// Planibble — Palette C "Petrolio vivace" (teal brand, cream surfaces).
// Rebrand oct 2026: migrated from the warm terracotta palette (Planibble era).
// Keep token NAMES identical so the whole app keeps compiling — only values change.
export const theme = {
  color: {
    // Surfaces — unchanged warm cream for comfort/readability.
    surface: '#FDFBF7',
    onSurface: '#1F2A2D',               // slightly cooler (was warm brown #3D342B)
    surfaceSecondary: '#F2F6F7',        // cool cream-blue
    onSurfaceSecondary: '#51606A',
    surfaceTertiary: '#E7EFF1',
    onSurfaceTertiary: '#6B7A82',
    surfaceInverse: '#102328',
    onSurfaceInverse: '#FDFBF7',

    // Brand — teal gradient from the logo, lifted to a more vivid tone.
    //   brand          = darker, used for backgrounds / emphasis blocks
    //   brandPrimary   = main CTA / tabs / headlines
    //   brandSecondary = secondary accent (chips, Pro+ visuals)
    //   brandTertiary  = pale fill for cards / selected states
    brand: '#1D8EA2',
    brandPrimary: '#1D8EA2',
    onBrandPrimary: '#FFFFFF',
    brandSecondary: '#4FB3C5',
    onBrandSecondary: '#FFFFFF',
    brandTertiary: '#E0F2F5',
    onBrandTertiary: '#0F6F80',

    // Semantics.
    success: '#4A8A6B',
    warning: '#E0A458',
    error: '#C96B4A',

    // Borders & dividers — cool neutral.
    border: '#D5DFE2',
    borderStrong: '#AFBEC3',
    divider: '#E7EFF1',
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
