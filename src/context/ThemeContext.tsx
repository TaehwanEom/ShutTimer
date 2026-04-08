import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeColors, lightColors, darkColors } from '../constants/theme';
import { SETTINGS_KEY, DEFAULT_SETTINGS } from '../constants/settings';

type ThemeContextType = {
  colors: ThemeColors;
  isDark: boolean;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextType>({
  colors: lightColors,
  isDark: false,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(DEFAULT_SETTINGS.darkMode);

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY.DARK_MODE).then(value => {
      if (value !== null) setIsDark(value === 'true');
    });
  }, []);

  const toggleTheme = () => {
    setIsDark(prev => {
      const next = !prev;
      AsyncStorage.setItem(SETTINGS_KEY.DARK_MODE, String(next));
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ colors: isDark ? darkColors : lightColors, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
