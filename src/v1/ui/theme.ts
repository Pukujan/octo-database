import { createTheme } from '@mui/material/styles';

export type OctoDesignSystemId = 'midnight' | 'paper';

/**
 * Product views use semantic tokens. This small adapter maps them to MUI today;
 * a different component system can consume the same tokens without changing
 * workspace behavior or page composition.
 */
export interface OctoDesignTokens {
  id: OctoDesignSystemId;
  mode: 'dark' | 'light';
  colors: {
    canvas: string;
    panel: string;
    raised: string;
    text: string;
    muted: string;
    border: string;
    accent: string;
    accentText: string;
    accentSoft: string;
    info: string;
    success: string;
    warning: string;
    danger: string;
  };
  radius: { small: number; medium: number; large: number };
}

export const designSystems: Record<OctoDesignSystemId, OctoDesignTokens> = {
  midnight: {
    id: 'midnight',
    mode: 'dark',
    colors: {
      canvas: '#0b0c0e',
      panel: '#111317',
      raised: '#181b20',
      text: '#f2f1eb',
      muted: '#92969e',
      border: '#272a30',
      accent: '#c5f36b',
      accentText: '#151a0c',
      accentSoft: '#242d19',
      info: '#9fcaff',
      success: '#c5f36b',
      warning: '#f3c969',
      danger: '#ff817e',
    },
    radius: { small: 10, medium: 16, large: 24 },
  },
  paper: {
    id: 'paper',
    mode: 'light',
    colors: {
      canvas: '#f4f3ee',
      panel: '#ffffff',
      raised: '#f7f7f3',
      text: '#171914',
      muted: '#62675f',
      border: '#dedfd8',
      accent: '#526e23',
      accentText: '#ffffff',
      accentSoft: '#ebf0df',
      info: '#265c99',
      success: '#526e23',
      warning: '#946d16',
      danger: '#b83c38',
    },
    radius: { small: 10, medium: 16, large: 24 },
  },
};

export function createOctoTheme(id: OctoDesignSystemId = 'midnight') {
  const tokens = designSystems[id];
  const { colors, radius } = tokens;

  return createTheme({
    palette: {
      mode: tokens.mode,
      primary: { main: colors.accent, contrastText: colors.accentText },
      secondary: { main: colors.info },
      background: { default: colors.canvas, paper: colors.panel },
      text: { primary: colors.text, secondary: colors.muted },
      divider: colors.border,
      success: { main: colors.success },
      info: { main: colors.info },
      warning: { main: colors.warning },
      error: { main: colors.danger },
    },
    typography: {
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif',
      h1: { fontWeight: 600, letterSpacing: '-0.055em' },
      h2: { fontWeight: 600, letterSpacing: '-0.045em' },
      h3: { fontWeight: 600, letterSpacing: '-0.035em' },
      h4: { fontWeight: 600, letterSpacing: '-0.03em' },
      h5: { fontWeight: 600, letterSpacing: '-0.025em' },
      h6: { fontWeight: 600, letterSpacing: '-0.02em' },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: { borderRadius: radius.medium },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: colors.canvas, color: colors.text },
          '*, *::before, *::after': { boxSizing: 'border-box' },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: radius.small, boxShadow: 'none', minHeight: 42 },
          containedPrimary: {
            color: colors.accentText,
            '&:hover': { backgroundColor: colors.accent, boxShadow: 'none', filter: 'brightness(1.04)' },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: { border: '1px solid ' + colors.border, boxShadow: 'none' },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: radius.small,
            '& fieldset': { borderColor: colors.border },
            '&:hover fieldset': { borderColor: colors.muted },
          },
        },
      },
    },
  });
}

export const octoTheme = createOctoTheme('midnight');
