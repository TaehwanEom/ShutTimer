import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';

// v1.6 후속 — 외부 Stack.Screen 측 하단 시각 Tab Bar (= MainTabsNavigator default Tab Bar 모방).
// 누름 시 navigate('Home', { screen: tabKey }) → root Stack 측 'Home' 자동 stack pop + 명시 Tab 활성.
// v1.8 — i18n 적용 (= tabBar.home/routine/alarm/calendar/settings 키 = MainTabsNavigator 정합).

const TABS = [
  { key: 'HomeTab', labelKey: 'tabBar.home', icon: 'timer' },
  { key: 'RoutineTab', labelKey: 'tabBar.routine', icon: 'repeat' },
  { key: 'AlarmTab', labelKey: 'tabBar.alarm', icon: 'alarm' },
  { key: 'CalendarTab', labelKey: 'tabBar.calendar', icon: 'calendar-today' },
  { key: 'SettingsTab', labelKey: 'tabBar.settings', icon: 'settings' },
] as const;

export default function BottomTabBar() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const handlePress = (tabKey: string) => {
    navigation.navigate('Home', { screen: tabKey } as any);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceContainerLowest, paddingBottom: insets.bottom, borderTopColor: colors.outlineVariant }]}>
      {TABS.map(tab => (
        <TouchableOpacity
          key={tab.key}
          style={styles.tab}
          onPress={() => handlePress(tab.key)}
          activeOpacity={0.7}
        >
          <MaterialIcons name={tab.icon as React.ComponentProps<typeof MaterialIcons>['name']} size={24} color={colors.secondary} />
          <Text style={[styles.label, { color: colors.secondary }]}>{t(tab.labelKey)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  label: {
    fontSize: 10,
    marginTop: 2,
    fontWeight: '500',
  },
});
