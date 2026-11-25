import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: ThemeChoice;
  resolvedTheme: Exclude<ThemeChoice, 'system'>;
  setTheme: (theme: ThemeChoice) => void;
}

const STORAGE_KEY = 'huroof-theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): Exclude<ThemeChoice, 'system'> {
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
}

function readSavedTheme(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch { /* Storage can be disabled on the display device. */ }
  return 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(readSavedTheme);
  const [systemTheme, setSystemTheme] = useState<Exclude<ThemeChoice, 'system'>>(getSystemTheme);
  const resolvedTheme = theme === 'system' ? systemTheme : theme;

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemTheme(query.matches ? 'dark' : 'light');
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"][data-theme]')) {
      meta.setAttribute('media', theme === 'system'
        ? `(prefers-color-scheme: ${meta.dataset.theme})`
        : meta.dataset.theme === theme ? 'all' : 'not all');
    }
  }, [resolvedTheme, theme]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    resolvedTheme,
    setTheme: (nextTheme) => {
      setThemeState(nextTheme);
      try { window.localStorage.setItem(STORAGE_KEY, nextTheme); } catch { /* Keep the choice for this visit. */ }
    },
  }), [resolvedTheme, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within ThemeProvider');
  return value;
}
