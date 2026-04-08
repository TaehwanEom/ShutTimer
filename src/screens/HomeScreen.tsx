import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RootStackParamList } from '../../App';
import { ThemeColors } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { MISSIONS, MISSIONS_STORAGE_KEY, Mission } from '../constants/missions';
import TimerDial from '../components/TimerDial';
import AdBanner from '../components/AdBanner';
import { useTranslation } from 'react-i18next';
// AdMob — EAS Development Build 필요, Expo Go 불가
// import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
// import { Platform } from 'react-native';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.onBackground,
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 16,
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  dialSection: {
    marginTop: 32,
    marginBottom: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missionSection: {
    width: '100%',
    marginBottom: 48,
  },
  missionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.onBackground,
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 24,
  },
  missionList: {
    paddingHorizontal: 8,
    gap: 24,
  },
  missionItem: {
    alignItems: 'center',
    gap: 8,
  },
  missionIcon: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  missionIconSelected: {
    borderColor: colors.primary,
  },
  missionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.secondary,
  },
  missionLabelSelected: {
    color: colors.primary,
  },
  addTimerBtn: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.secondary,
    opacity: 0.7,
  },
  startButton: {
    width: '100%',
    maxWidth: 400,
    paddingVertical: 20,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: 2,
  },
});

export default function HomeScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  const [missionList, setMissionList] = useState<Mission[]>(MISSIONS);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [selectedMinutes, setSelectedMinutes] = useState(60);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(MISSIONS_STORAGE_KEY).then(value => {
        const list: Mission[] = value ? JSON.parse(value) : MISSIONS;
        setMissionList(list);
        setSelectedIndex(prev => prev >= list.length ? -1 : prev);
      });
    }, [])
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="timer" size={24} color={colors.primary} />
          <Text style={styles.headerTitle}>ShutTimer</Text>
        </View>
        <View style={styles.headerRight}>
          <MaterialIcons name="notifications" size={24} color={colors.secondary} style={{ opacity: 0.4 }} />
          <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
            <MaterialIcons name="settings" size={24} color={colors.onBackground} style={{ opacity: 0.6 }} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} scrollEnabled={scrollEnabled}>
        {/* Analog Timer Dial */}
        <View style={styles.dialSection}>
          <TimerDial
            progress={selectedMinutes / 60}
            timeText={`${selectedMinutes}:00`}
            subText={t('home.minutes')}
            onSeek={(m) => { setSelectedMinutes(m); setSelectedIndex(-1); }}
            onSeekStart={() => setScrollEnabled(false)}
            onSeekEnd={() => setScrollEnabled(true)}
          />
        </View>

        {/* Mission Selection */}
        <View style={styles.missionSection}>
          <Text style={styles.missionTitle}>{t('home.favorites')}</Text>
          {missionList.length === 0 ? (
            <View style={{ alignItems: 'center' }}>
              <TouchableOpacity style={styles.missionItem} onPress={() => navigation.navigate('EditMissions')}>
                <View style={styles.addTimerBtn}>
                  <MaterialIcons name="add" size={26} color={colors.secondary} />
                </View>
                <Text style={styles.missionLabel}>{t('home.add')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.missionList}>
              <TouchableOpacity style={styles.missionItem} onPress={() => navigation.navigate('EditMissions')}>
                <View style={styles.addTimerBtn}>
                  <MaterialIcons name="add" size={26} color={colors.secondary} />
                </View>
                <Text style={styles.missionLabel}>{t('home.add')}</Text>
              </TouchableOpacity>
              {missionList.map((mission, index) => {
                const isSelected = selectedIndex === index;
                return (
                  <TouchableOpacity
                    key={`${mission.id}-${index}`}
                    style={styles.missionItem}
                    onPress={() => {
                      if (selectedIndex === index) {
                        setSelectedIndex(-1);
                      } else {
                        setSelectedIndex(index);
                        setSelectedMinutes(mission.defaultMinutes ?? 60);
                      }
                    }}
                  >
                    <View style={[styles.missionIcon, isSelected && styles.missionIconSelected]}>
                      <MaterialIcons
                        name={mission.icon as any}
                        size={28}
                        color={isSelected ? colors.primary : colors.secondary}
                      />
                    </View>
                    <Text style={[styles.missionLabel, isSelected && styles.missionLabelSelected]}>
                      {mission.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* Start Button */}
        <TouchableOpacity
          style={styles.startButton}
          onPress={() => navigation.navigate('Running', { mission: missionList[selectedIndex] ?? null, minutes: selectedMinutes })}
          activeOpacity={0.85}
        >
          <Text style={styles.startButtonText}>{t('home.start')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <AdBanner />
    </SafeAreaView>
  );
}
