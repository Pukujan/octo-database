import * as React from "react";

/**
 * Interchangeable design systems.
 *
 * Each preset is pure CSS tokens (see styles/globals.css). Adding a design
 * system means adding one `[data-theme="..."]` block there and one entry here.
 */
export type ThemeId =
  | "midnight"
  | "graphite"
  | "violet"
  | "ember"
  | "nord"
  | "daylight"
  | "sand";

export interface ThemePreset {
  id: ThemeId;
  name: string;
  blurb: string;
  mode: "dark" | "light";
  /** Three representative colours for the picker swatch. */
  swatch: [string, string, string];
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "midnight",
    name: "Midnight Lime",
    blurb: "Octo house dark theme",
    mode: "dark",
    swatch: ["hsl(228 14% 6%)", "hsl(80 74% 68%)", "hsl(190 70% 55%)"],
  },
  {
    id: "graphite",
    name: "Graphite",
    blurb: "Neutral dark, blue accent",
    mode: "dark",
    swatch: ["hsl(220 13% 10%)", "hsl(212 92% 62%)", "hsl(255 70% 68%)"],
  },
  {
    id: "violet",
    name: "Violet",
    blurb: "Soft dark, rounded",
    mode: "dark",
    swatch: ["hsl(260 24% 8%)", "hsl(265 84% 70%)", "hsl(200 75% 58%)"],
  },
  {
    id: "ember",
    name: "Ember",
    blurb: "Warm dark, orange accent",
    mode: "dark",
    swatch: ["hsl(20 18% 8%)", "hsl(24 92% 60%)", "hsl(45 92% 58%)"],
  },
  {
    id: "nord",
    name: "Nord",
    blurb: "Cool slate, teal accent",
    mode: "dark",
    swatch: ["hsl(213 22% 13%)", "hsl(180 55% 58%)", "hsl(210 70% 64%)"],
  },
  {
    id: "daylight",
    name: "Daylight",
    blurb: "Clean light, blue accent",
    mode: "light",
    swatch: ["hsl(210 30% 98%)", "hsl(222 84% 52%)", "hsl(184 68% 40%)"],
  },
  {
    id: "sand",
    name: "Sand",
    blurb: "Warm light, terracotta accent",
    mode: "light",
    swatch: ["hsl(40 40% 97%)", "hsl(22 78% 46%)", "hsl(176 50% 40%)"],
  },
];

export const DEFAULT_THEME: ThemeId = "midnight";

const STORAGE_KEY = "octo.theme";

interface ThemeContextValue {
  theme: ThemeId;
  preset: ThemePreset;
  presets: ThemePreset[];
  setTheme: (id: ThemeId) => void;
  isDark: boolean;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function readStoredTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && THEME_PRESETS.some((preset) => preset.id === stored)) {
    return stored as ThemeId;
  }
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemeId>(readStoredTheme);

  const preset = React.useMemo(
    () => THEME_PRESETS.find((candidate) => candidate.id === theme) ?? THEME_PRESETS[0]!,
    [theme],
  );

  React.useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.classList.toggle("dark", preset.mode === "dark");
    root.style.colorScheme = preset.mode;
  }, [theme, preset.mode]);

  const setTheme = React.useCallback((id: ThemeId) => {
    setThemeState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* storage unavailable (private mode) — theme still applies for the session */
    }
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, preset, presets: THEME_PRESETS, setTheme, isDark: preset.mode === "dark" }),
    [theme, preset, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside <ThemeProvider>");
  return context;
}
