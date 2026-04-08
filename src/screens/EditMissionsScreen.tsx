import React, { useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Switch,
  ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { Mission, MISSIONS, MISSIONS_STORAGE_KEY } from '../constants/missions';
import { useTranslation } from 'react-i18next';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'EditMissions'>;
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
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 120,
  },
  itemCard: {
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerLow,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: {
    flex: 1,
    gap: 3,
  },
  itemLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.onBackground,
  },
  itemTime: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.secondary,
  },
  itemRepeat: {
    alignItems: 'center',
    gap: 2,
  },
  itemRepeatLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.secondary,
    letterSpacing: 0.5,
  },
  deleteBtn: {
    padding: 6,
  },
  addButton: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
    paddingVertical: 18,
    borderRadius: 12,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: 0.5,
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
    paddingBottom: 48,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.onBackground,
    letterSpacing: -0.3,
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  iconRowWrapper: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconRowLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onBackground,
  },
  separator: {
    height: 1,
    backgroundColor: colors.surfaceContainerLow,
    marginHorizontal: 24,
  },
});

export default function EditMissionsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  const [missions, setMissions] = useState<Mission[]>([]);

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(MISSIONS_STORAGE_KEY).then(value => {
        setMissions(value ? JSON.parse(value) : MISSIONS);
      });
    }, [])
  );

  const save = (updated: Mission[]) => {
    setMissions(updated);
    AsyncStorage.setItem(MISSIONS_STORAGE_KEY, JSON.stringify(updated));
  };

  const handleToggle = (id: string, value: boolean) => {
    save(missions.map(m => m.id === id ? { ...m, enabled: value } : m));
  };

  const handleDelete = (id: string) => {
    save(missions.filter(m => m.id !== id));
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('editMissions.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Mission List */}
        <View style={styles.listContent}>
          {missions.map((item) => (
            <TouchableOpacity key={item.id} style={styles.itemCard} onPress={() => navigation.navigate('AddTimer', { editId: item.id, editIcon: item.icon, editMinutes: item.defaultMinutes ?? 60 })}>
              <View style={styles.itemIconWrapper}>
                <MaterialIcons name={item.icon as any} size={22} color={colors.primary} />
              </View>
              <View style={styles.itemInfo}>
                <Text style={styles.itemLabel}>{item.label}</Text>
                {item.defaultMinutes != null && (
                  <Text style={styles.itemTime}>{`${item.defaultMinutes}:00`}</Text>
                )}
              </View>
              <View style={styles.itemRepeat}>
                <Text style={styles.itemRepeatLabel}>{t('editMissions.repeat')}</Text>
                <Switch
                  value={item.enabled !== false}
                  onValueChange={(v) => handleToggle(item.id, v)}
                  trackColor={{ false: colors.surfaceContainerLowest, true: colors.primary }}
                  thumbColor={colors.onPrimary}
                  style={{ transform: [{ scale: 0.8 }] }}
                />
              </View>
              <TouchableOpacity style={styles.deleteBtn} onPress={(e) => { e.stopPropagation?.(); handleDelete(item.id); }}>
                <MaterialIcons name="delete-outline" size={22} color={colors.secondary} style={{ opacity: 0.7 }} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('AddTimer')}>
        <MaterialIcons name="add" size={22} color={colors.onPrimary} />
        <Text style={styles.addButtonText}>{t('editMissions.addButton')}</Text>
      </TouchableOpacity>

    </SafeAreaView>
  );
}
