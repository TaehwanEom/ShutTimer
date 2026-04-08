import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Modal,
  ScrollView,
  Dimensions,
} from 'react-native';

const SCREEN_WIDTH = Dimensions.get('window').width;
const ICONS_PER_PAGE = 8;
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { MISSIONS, MISSIONS_STORAGE_KEY, ICON_OPTIONS, ICON_LABELS } from '../constants/missions';
import TimerDial from '../components/TimerDial';
import { useTranslation } from 'react-i18next';

import { RouteProp } from '@react-navigation/native';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'AddTimer'>;
  route: RouteProp<RootStackParamList, 'AddTimer'>;
};

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  backBtn: {
    padding: 8,
    borderRadius: 50,
    width: 40,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.onBackground,
    letterSpacing: -0.5,
  },
  dialSection: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 36,
  },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerLow,
  },
  typeRowLeft: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.onBackground,
    flex: 1,
  },
  typeRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  typeRowValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  typeRowPlaceholder: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.secondary,
    opacity: 0.7,
  },
  saveButton: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
    paddingVertical: 18,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: 0.5,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 20,
    paddingBottom: 32,
    height: 420,
  },
  iconCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerLow,
  },
  iconCellWrapper: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCellLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.onBackground,
    flex: 1,
  },
  iconPage: {
    width: SCREEN_WIDTH,
    paddingHorizontal: 12,
  },
  iconRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.secondary,
    opacity: 0.3,
  },
  dotActive: {
    opacity: 1,
    backgroundColor: colors.primary,
  },
});

export default function AddTimerScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  const editId = route?.params?.editId;
  const isEdit = !!editId;

  const [selectedMinutes, setSelectedMinutes] = useState(route?.params?.editMinutes ?? 60);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [selectedIcon, setSelectedIcon] = useState<string | null>(route?.params?.editIcon ?? null);
  const [modalVisible, setModalVisible] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const pageScrollRef = useRef<ScrollView>(null);


  const handleSelectIcon = (icon: string) => {
    setSelectedIcon(icon);
    setModalVisible(false);
  };

  const handleSave = async () => {
    if (!selectedIcon) return;
    const label = t(`icons.${selectedIcon}`);
    const value = await AsyncStorage.getItem(MISSIONS_STORAGE_KEY);
    const list = value ? JSON.parse(value) : MISSIONS;
    const updated = isEdit
      ? list.map((m: any) => m.id === editId ? { ...m, label, icon: selectedIcon, defaultMinutes: selectedMinutes } : m)
      : [...list, { id: Date.now().toString(), label, icon: selectedIcon, enabled: true, defaultMinutes: selectedMinutes }];
    await AsyncStorage.setItem(MISSIONS_STORAGE_KEY, JSON.stringify(updated));
    navigation.goBack();
  };

  const availableIcons = ICON_OPTIONS.filter(icon => icon !== selectedIcon);
  const pages: string[][] = [];
  for (let i = 0; i < availableIcons.length; i += ICONS_PER_PAGE) {
    pages.push(availableIcons.slice(i, i + ICONS_PER_PAGE));
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEdit ? t('addTimer.editTitle') : t('addTimer.addTitle')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView scrollEnabled={scrollEnabled} showsVerticalScrollIndicator={false}>
        {/* Dial */}
        <View style={styles.dialSection}>
          <TimerDial
            progress={selectedMinutes / 60}
            timeText={`${selectedMinutes}:00`}
            subText={t('addTimer.minutes')}
            onSeek={(m) => setSelectedMinutes(m)}
            onSeekStart={() => setScrollEnabled(false)}
            onSeekEnd={() => setScrollEnabled(true)}
          />
        </View>

        {/* 타이머 종류 */}
        <TouchableOpacity style={styles.typeRow} onPress={() => { setCurrentPage(0); setModalVisible(true); setTimeout(() => pageScrollRef.current?.scrollTo({ x: 0, animated: false }), 100); }}>
          <Text style={styles.typeRowLeft}>{t('addTimer.timerType')}</Text>
          <View style={styles.typeRowRight}>
            {selectedIcon ? (
              <>
                <MaterialIcons name={selectedIcon as any} size={18} color={colors.primary} />
                <Text style={styles.typeRowValue}>{t(`icons.${selectedIcon}`)}</Text>
              </>
            ) : (
              <Text style={styles.typeRowPlaceholder}>{t('addTimer.selectType')}</Text>
            )}
            <MaterialIcons name="chevron-right" size={20} color={colors.secondary} style={{ opacity: 0.5 }} />
          </View>
        </TouchableOpacity>
      </ScrollView>

      {/* 저장 버튼 */}
      <TouchableOpacity
        style={[styles.saveButton, !selectedIcon && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={!selectedIcon}
      >
        <Text style={styles.saveButtonText}>{t('addTimer.save')}</Text>
      </TouchableOpacity>

      {/* 아이콘 모달 */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          {/* 배경 닫기 영역 — 시트 위쪽만 */}
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setModalVisible(false)} />
          {/* 시트 */}
          <View style={styles.modalSheet}>
            <ScrollView
              ref={pageScrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              bounces={false}
              style={{ flex: 1 }}
              onMomentumScrollEnd={e => {
                const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                if (page >= pages.length) {
                  setCurrentPage(0);
                  setTimeout(() => {
                    pageScrollRef.current?.scrollTo({ x: 0, animated: false });
                  }, 50);
                } else {
                  setCurrentPage(page);
                }
              }}
            >
              {[...pages, pages[0]].map((page, pi) => (
                <View key={pi} style={styles.iconPage}>
                  {Array.from({ length: Math.ceil(page.length / 2) }, (_, rowIdx) => (
                    <View key={rowIdx} style={styles.iconRow}>
                      {page.slice(rowIdx * 2, rowIdx * 2 + 2).map(icon => (
                        <TouchableOpacity key={icon} style={styles.iconCell} onPress={() => handleSelectIcon(icon)}>
                          <View style={styles.iconCellWrapper}>
                            <MaterialIcons name={icon as any} size={22} color={colors.primary} />
                          </View>
                          <Text style={styles.iconCellLabel}>{t(`icons.${icon}`)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
            <View style={styles.dotsRow}>
              {pages.map((_, pi) => (
                <View key={pi} style={[styles.dot, pi === currentPage && styles.dotActive]} />
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
