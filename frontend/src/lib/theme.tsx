import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// The saved colour system applies to every screen — login, the shell, and the
// public share viewer — so it lives on the document element, not inside a view.
export type ThemeName = 'dark' | 'paper';

const STORAGE_KEY = 'octo-design-system';

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): ThemeName {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'paper' ? 'paper' : 'dark';
  } catch {
    return 'dark';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(readStored);

  useEffect(() => {
    document.documentElement.setAttribute('data-octo-system', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // A private window may refuse storage; the attribute above still applies.
    }
  }, [theme]);

  const value: ThemeContextValue = {
    theme,
    setTheme,
    toggle: () => setTheme((current) => (current === 'dark' ? 'paper' : 'dark')),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
