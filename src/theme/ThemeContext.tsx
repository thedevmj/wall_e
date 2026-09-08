import React from 'react';
import { getMetaSync, setMetaSync } from '../services/db';
import { createStyles } from '../styles';
import { darkPalette, lightPalette, type ThemePalette } from './palette';

export type ThemeMode = 'light' | 'dark';

type ThemeContextValue = {
  mode: ThemeMode;
  isDark: boolean;
  palette: ThemePalette;
  styles: ReturnType<typeof createStyles>;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
};

const THEME_STORAGE_KEY = 'theme';

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function readStoredMode(): ThemeMode {
  try {
    return getMetaSync(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch (error) {
    console.warn('Failed to read stored theme', error);
    return 'light';
  }
}

function persistMode(mode: ThemeMode): void {
  try {
    setMetaSync(THEME_STORAGE_KEY, mode);
  } catch (error) {
    console.warn('Failed to persist theme', error);
  }
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (ctx == null) {
    const palette = lightPalette;
    return {
      mode: 'light',
      isDark: false,
      palette,
      styles: createStyles(palette),
      toggleTheme: () => undefined,
      setTheme: () => undefined,
    };
  }
  return ctx;
}

export function useThemedStyles(): ReturnType<typeof createStyles> {
  return useTheme().styles;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = React.useState<ThemeMode>(readStoredMode);

  const palette = mode === 'dark' ? darkPalette : lightPalette;
  const styles = React.useMemo(() => createStyles(palette), [palette]);

  const setTheme = React.useCallback((next: ThemeMode) => {
    setMode(prev => {
      if (prev === next) return prev;
      persistMode(next);
      return next;
    });
  }, []);

  const toggleTheme = React.useCallback(() => {
    setMode(prev => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      persistMode(next);
      return next;
    });
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ mode, isDark: palette.isDark, palette, styles, toggleTheme, setTheme }),
    [mode, palette, styles, toggleTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}