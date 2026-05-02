import React, { useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, Animated, PanResponder, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Mission, MISSIONS, MISSIONS_STORAGE_KEY } from '../constants/missions';
import { useTheme } from '../context/ThemeContext';
import { RootStackParamList } from '../../App';
import AdBanner from '../components/AdBanner';

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
  t: ReturnType<typeof useTranslation>['t'];
};

function FavoriteItem({ mission, onSelect, onEdit, onDelete, colors, t }: ItemProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const swipeOffsetRef = useRef(0);
  const [swipeRevealEdit, setSwipeRevealEdit] = useState(false);
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
          } else if (editByDist || (tx > 0 && editByVel)) {
            Animated.spring(translateX, { toValue: EDIT_SLIDE_WIDTH, useNativeDriver: true, bounciness: 0 }).start();
            setSwipeRevealEdit(true);
          } else {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
            setSwipeRevealEdit(false);
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          setSwipeRevealEdit(false);
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
    <View style={{ marginBottom: 8, position: 'relative' }}>
      {/* 휴지통 (뒤에 깔림, 우측) */}
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
          backgroundColor: colors.error,
          borderRadius: 12,
        }}
      >
        <MaterialIcons name="delete" size={24} color={colors.onPrimary} />
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
            backgroundColor: colors.surfaceContainerLow,
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
          style={[styles.itemRow, { backgroundColor: colors.surfaceContainerLow }]}
          onPress={onSelect}
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
  const { colors } = useTheme();
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

  const handleEdit = (mission: Mission) => {
    navigation.navigate('AddTimer', {
      editId: mission.id,
      editIcon: mission.icon,
      editMinutes: mission.defaultMinutes ?? 60,
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
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
        <View style={styles.emptyContainer}>
          <MaterialIcons name="bookmark-border" size={64} color={colors.outlineVariant} />
          <TouchableOpacity style={[styles.addButton, { backgroundColor: colors.primary }]} onPress={handleAdd}>
            <MaterialIcons name="add" size={20} color={colors.onPrimary} />
            <Text style={[styles.addButtonText, { color: colors.onPrimary }]}>
              {t('home.add', { defaultValue: '추가' })}
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
              t={t}
            />
          )}
          keyExtractor={(item, idx) => `${item.id}-${idx}`}
          contentContainerStyle={styles.listContent}
        />
      )}

      <AdBanner />
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
    borderRadius: 12,
  },
  itemLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  itemDuration: {
    fontSize: 13,
    marginTop: 2,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
