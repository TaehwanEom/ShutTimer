import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeColors, lightColors, darkColors } from '../constants/theme';
import { SETTINGS_KEY, DEFAULT_SETTINGS } from '../constants/settings';

type ThemeContextType = {
  colors: ThemeColors;
  isDark: boolean;
  toggleTheme: () => void;
  primaryColor: string;
  setPrimaryColor: (color: string) => void;
};

const ThemeContext = createContext<ThemeContextType>({
  colors: lightColors,
  isDark: false,
  toggleTheme: () => {},
  primaryColor: lightColors.primary,
  setPrimaryColor: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(DEFAULT_SETTINGS.darkMode);
  const [primaryColor, setPrimaryColorState] = useState(lightColors.primary);

  useEffect(() => {
    AsyncStorage.multiGet([SETTINGS_KEY.DARK_MODE, SETTINGS_KEY.PRIMARY_COLOR]).then(pairs => {
      if (pairs[0][1] !== null) setIsDark(pairs[0][1] === 'true');
      if (pairs[1][1]) setPrimaryColorState(pairs[1][1]);
    });
  }, []);

  const toggleTheme = () => {
    setIsDark(prev => {
      const next = !prev;
      AsyncStorage.setItem(SETTINGS_KEY.DARK_MODE, String(next));
      return next;
    });
  };

  const setPrimaryColor = (color: string) => {
    setPrimaryColorState(color);
    AsyncStorage.setItem(SETTINGS_KEY.PRIMARY_COLOR, color);
  };

  const baseColors = isDark ? darkColors : lightColors;
  const colors: ThemeColors = {
    ...baseColors,
    primary: primaryColor,
  };

  return (
    <ThemeContext.Provider value={{ colors, isDark, toggleTheme, primaryColor, setPrimaryColor }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
