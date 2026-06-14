import React, { useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, Animated, PanResponder, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Mission, MISSIONS, MISSIONS_STORAGE_KEY } from '../constants/missions';
import { SETTINGS_KEY } from '../constants/settings';
import { useTheme } from '../context/ThemeContext';
import { RootStackParamList } from '../../App';
import AdBanner from '../components/AdBanner';
import BottomTabBar from '../components/BottomTabBar';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'FavoritesList'>;
};

// v1.6 후속 — RoutineList 측 swipe 패턴 영역 동일 모방.
const SWIPE_MAX = 64;            // 휴지통 width
const EDIT_SLIDE_WIDTH = 56;     // 편집 width
const TRASH_DISTANCE_THRESHOLD = 32;
const EDIT_DISTANCE_THRESHOLD = 18;
const VELOCITY_THRESHOLD = 0.25;

type ItemProps = {
  mission: Mission;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
  isDark: boolean;
  t: ReturnType<typeof useTranslation>['t'];
};

function FavoriteItem({ mission, onSelect, onEdit, onDelete, colors, isDark, t }: ItemProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const swipeOffsetRef = useRef(0);
  const [swipeRevealEdit, setSwipeRevealEdit] = useState(false);
  // v1.7 — iOS Mail 패턴: swipe open 상태에서 카드 본체 tap = swipe 닫기.
  const [swipeRevealTrash, setSwipeRevealTrash] = useState(false);
  const [itemHeight, setItemHeight] = useState(0);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          translateX.stopAnimation();
        },
        onPanResponderMove: (_, g) => {
          const next = Math.max(-SWIPE_MAX, Math.min(EDIT_SLIDE_WIDTH, g.dx));
          translateX.setValue(next);
          swipeOffsetRef.current = next;
        },
        onPanResponderRelease: (_, g) => {
          const tx = swipeOffsetRef.current;
          const trashByDist = -tx >= TRASH_DISTANCE_THRESHOLD;
          const trashByVel = g.vx <= -VELOCITY_THRESHOLD;
          const editByDist = tx >= EDIT_DISTANCE_THRESHOLD;
          const editByVel = g.vx >= VELOCITY_THRESHOLD;
          if (trashByDist || (tx < 0 && trashByVel)) {
            Animated.spring(translateX, { toValue: -SWIPE_MAX, useNativeDriver: true, bounciness: 0 }).start();
            setSwipeRevealEdit(false);
            setSwipeRevealTrash(true);
          } else if (editByDist || (tx > 0 && editByVel)) {
            Animated.spring(translateX, { toValue: EDIT_SLIDE_WIDTH, useNativeDriver: true, bounciness: 0 }).start();
            setSwipeRevealEdit(true);
            setSwipeRevealTrash(false);
          } else {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
            setSwipeRevealEdit(false);
            setSwipeRevealTrash(false);
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          setSwipeRevealEdit(false);
          setSwipeRevealTrash(false);
        },
      }),
    [translateX]
  );

  const handleDeleteTap = () => {
    Alert.alert(
      t('favorites.deleteConfirmTitle', { defaultValue: '삭제 확인' }),
      t('favorites.deleteConfirmBody', { defaultValue: '이 즐겨찾기를 삭제할까요?' }),
      [
        {
          text: t('common.cancel', { defaultValue: '취소' }),
          style: 'cancel',
          onPress: () => {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          },
        },
        {
          text: t('favorites.actionDelete', { defaultValue: '삭제' }),
          style: 'destructive',
          onPress: () => {
            Animated.timing(translateX, { toValue: -500, duration: 220, useNativeDriver: true }).start(onDelete);
          },
        },
      ],
      { cancelable: true, onDismiss: () => Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start() }
    );
  };

  const handleEditTap = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    setSwipeRevealEdit(false);
    onEdit();
  };

  return (
    <View style={{ marginBottom: 0, position: 'relative' }}>
      {/* 휴지통 (뒤에 깔림, 우측) — touch area = reveal 영역 풀 / 시각 = 원형 56×56. */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={handleDeleteTap}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          height: itemHeight,
          width: SWIPE_MAX,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialIcons name="delete" size={24} color={colors.onPrimary} />
        </View>
      </TouchableOpacity>

      {/* 편집 펜슬 (뒤에 깔림, 좌측) */}
      <View
        pointerEvents={swipeRevealEdit ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          height: itemHeight,
          width: EDIT_SLIDE_WIDTH,
          paddingRight: 6,
        }}
      >
        <TouchableOpacity
          onPress={handleEditTap}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            flex: 1,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surfaceContainerLowest,
          }}
        >
          <MaterialIcons name="edit" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* 항목 본체 (swipe 영역) */}
      <Animated.View
        {...panResponder.panHandlers}
        onLayout={e => setItemHeight(e.nativeEvent.layout.height)}
        style={{ transform: [{ translateX }] }}
      >
        <TouchableOpacity
          style={[styles.itemRow, { backgroundColor: colors.surfaceContainerLowest, borderBottomColor: isDark ? colors.outlineVariant : '#D1D1D6' }]}
          onPress={() => {
            // v1.7 — iOS Mail 패턴: swipe open 시 = 닫기 우선. 그 외 = 선택.
            if (swipeRevealTrash || swipeRevealEdit) {
              Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
              setSwipeRevealTrash(false);
              setSwipeRevealEdit(false);
              return;
            }
            onSelect();
          }}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name={mission.icon as React.ComponentProps<typeof MaterialIcons>['name']}
            size={28}
            color={colors.primary}
          />
          <View style={{ flex: 1, marginLeft: 16 }}>
            <Text style={[styles.itemLabel, { color: colors.onBackground }]}>
              {t(`icons.${mission.icon}`, { defaultValue: mission.icon })}
            </Text>
            <Text style={[styles.itemDuration, { color: colors.secondary }]}>
              {mission.defaultMinutes ?? 60} {t('home.minutes', { defaultValue: '분' })}
            </Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color={colors.secondary} />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

export default function FavoritesListScreen({ navigation }: Props) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const [missionList, setMissionList] = useState<Mission[]>(MISSIONS);

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(MISSIONS_STORAGE_KEY).then(value => {
        const list: Mission[] = value ? JSON.parse(value) : MISSIONS;
        setMissionList(list);
      });
    }, [])
  );

  const handleSelect = (mission: Mission) => {
    navigation.navigate('Home', { screen: 'HomeTab', params: { selectedFavoriteId: mission.id } } as any);
  };

  const handleEdit = async (mission: Mission) => {
    // v1.6 후속 — dialType 미전달 시 AddTimer mount 직후 'classic' 깜빡임 영역 정정. 사용자 dial 영역 즉시 정합.
    const dialTypeRaw = await AsyncStorage.getItem(SETTINGS_KEY.DIAL_TYPE);
    const dialType = dialTypeRaw === 'digital' ? 'digital' : 'classic';
    navigation.navigate('AddTimer', {
      editId: mission.id,
      editIcon: mission.icon,
      editMinutes: mission.defaultMinutes ?? 60,
      dialType,
    });
  };

  const handleDelete = async (mission: Mission) => {
    const next = missionList.filter(m => m.id !== mission.id);
    setMissionList(next);
    await AsyncStorage.setItem(MISSIONS_STORAGE_KEY, JSON.stringify(next));
  };

  const handleAdd = () => {
    navigation.navigate('AddTimer', { editMinutes: 0 });
  };

  const handleBack = () => {
    navigation.goBack();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.surfaceContainerLowest }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isDark ? colors.outlineVariant : '#D1D1D6' }]}>
        <TouchableOpacity onPress={handleBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialIcons name="arrow-back" size={28} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.onBackground }]}>
          {t('favorites.title', { defaultValue: '즐겨찾기' })}
        </Text>
        <TouchableOpacity onPress={handleAdd} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialIcons name="add" size={28} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {missionList.length === 0 ? (
        <View style={styles.emptyBox}>
          <MaterialIcons name="bookmark-border" size={48} color={colors.secondary} />
          <Text style={[styles.emptyText, { color: colors.secondary }]}>
            {t('favorites.empty', { defaultValue: '즐겨찾기가 없습니다' })}
          </Text>
          <TouchableOpacity style={[styles.emptyBtn, { backgroundColor: colors.primary }]} onPress={handleAdd}>
            <MaterialIcons name="add" size={20} color={colors.onPrimary} />
            <Text style={[styles.emptyBtnText, { color: colors.onPrimary }]}>
              {t('favorites.addButton', { defaultValue: '즐겨찾기 추가' })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={missionList}
          renderItem={({ item }) => (
            <FavoriteItem
              mission={item}
              onSelect={() => handleSelect(item)}
              onEdit={() => handleEdit(item)}
              onDelete={() => handleDelete(item)}
              colors={colors}
              isDark={isDark}
              t={t}
            />
          )}
          keyExtractor={(item, idx) => `${item.id}-${idx}`}
          contentContainerStyle={styles.listContent}
        />
      )}

      <AdBanner />
      <BottomTabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  itemDuration: {
    fontSize: 13,
    marginTop: 2,
  },
  emptyBox: {
    flex: 1,
    marginTop: 80,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 15,
    marginTop: 12,
    marginBottom: 20,
    textAlign: 'center',
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  emptyBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
