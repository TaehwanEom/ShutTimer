// v1.6 Phase 4: 카테고리 선택 화면.
// 고정 10개 + 사용자 커스텀 라디오. 하단 [+ 새 카테고리 추가] 모달.
// 선택 시 RoutineEdit 으로 merge 복귀 (route.params 패턴).

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Modal,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import {
  FIXED_CATEGORIES,
  CategoryDef,
  loadCustomCategories,
  addCustomCategory,
  deleteCustomCategory,
  CUSTOM_CATEGORY_MAX,
  CUSTOM_CATEGORY_NAME_MAX,
} from '../constants/categories';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RoutineCategory'>;
  route: RouteProp<RootStackParamList, 'RoutineCategory'>;
};

export default function RoutineCategoryScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);
  const current = route.params?.current ?? null;

  const [custom, setCustom] = useState<CategoryDef[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [inputName, setInputName] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    loadCustomCategories().then(setCustom);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSelect = (id: string) => {
    navigation.navigate({
      name: 'RoutineEdit',
      params: { selectedCategory: id },
      merge: true,
    });
  };

  const handleAddOpen = () => {
    setInputName('');
    setInputError(null);
    setModalOpen(true);
  };

  const handleAddSubmit = async () => {
    const result = await addCustomCategory(inputName);
    if (!result.ok) {
      switch (result.reason) {
        case 'empty':
          setInputError(t('routine.category.errEmpty'));
          break;
        case 'too_long':
          setInputError(t('routine.category.errTooLong', { max: CUSTOM_CATEGORY_NAME_MAX }));
          break;
        case 'duplicate':
          setInputError(t('routine.category.errDuplicate'));
          break;
        case 'limit':
          setInputError(t('routine.category.errLimit', { max: CUSTOM_CATEGORY_MAX }));
          break;
      }
      return;
    }
    setCustom(result.list);
    setModalOpen(false);
  };

  const handleDeleteCustom = (id: string) => {
    Alert.alert(
      t('routine.category.deleteConfirmTitle'),
      t('routine.category.deleteConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('routine.actionDelete'),
          style: 'destructive',
          onPress: async () => {
            const next = await deleteCustomCategory(id);
            setCustom(next);
          },
        },
      ]
    );
  };

  const renderRow = (def: CategoryDef, displayLabel: string, canDelete: boolean) => {
    const isSelected = current === def.id;
    return (
      <TouchableOpacity
        key={def.id}
        style={[styles.row, isSelected && styles.rowSelected]}
        onPress={() => handleSelect(def.id)}
        onLongPress={canDelete ? () => handleDeleteCustom(def.id) : undefined}
        activeOpacity={0.7}
      >
        <View style={[styles.iconWrap, isSelected && styles.iconWrapSelected]}>
          <MaterialIcons
            name={def.icon as any}
            size={20}
            color={isSelected ? colors.onPrimary : colors.onBackground}
          />
        </View>
        <Text style={[styles.rowLabel, isSelected && styles.rowLabelSelected]}>{displayLabel}</Text>
        {isSelected && <MaterialIcons name="check-circle" size={22} color={colors.primary} />}
      </TouchableOpacity>
    );
  };

  const canAddMore = custom.length < CUSTOM_CATEGORY_MAX;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="chevron-left" size={32} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('routine.category.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>{t('routine.category.fixedSection')}</Text>
        {FIXED_CATEGORIES.map(def =>
          renderRow(def, def.labelKey ? t(def.labelKey) : def.label ?? def.id, false)
        )}

        {custom.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>
              {t('routine.category.customSection')}
            </Text>
            {custom.map(def => renderRow(def, def.label ?? def.id, true))}
          </>
        )}

        <TouchableOpacity
          style={[styles.addBtn, !canAddMore && styles.addBtnDisabled]}
          onPress={handleAddOpen}
          disabled={!canAddMore}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name="add"
            size={22}
            color={canAddMore ? colors.primary : colors.secondary}
          />
          <Text style={[styles.addBtnText, !canAddMore && { color: colors.secondary }]}>
            {t('routine.category.addButton')} ({custom.length}/{CUSTOM_CATEGORY_MAX})
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* 커스텀 추가 모달 */}
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('routine.category.addModalTitle')}</Text>
            <TextInput
              value={inputName}
              onChangeText={text => {
                setInputName(text);
                if (inputError) setInputError(null);
              }}
              placeholder={t('routine.category.addPlaceholder')}
              placeholderTextColor={colors.secondary}
              maxLength={CUSTOM_CATEGORY_NAME_MAX}
              style={styles.modalInput}
              autoFocus={Platform.OS !== 'web'}
            />
            {inputError && <Text style={styles.modalError}>{inputError}</Text>}
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setModalOpen(false)}>
                <Text style={[styles.modalBtnText, { color: colors.secondary }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtn} onPress={handleAddSubmit}>
                <Text style={[styles.modalBtnText, { color: colors.primary }]}>
                  {t('routine.category.addSave')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  backBtn: { padding: 8, borderRadius: 50, width: 44, alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.onBackground, letterSpacing: -0.5 },
  content: { paddingHorizontal: 16, paddingBottom: 48 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.secondary,
    letterSpacing: 1.5,
    marginTop: 12,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerLow,
    marginBottom: 8,
  },
  rowSelected: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapSelected: { backgroundColor: colors.primary },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.onBackground },
  rowLabelSelected: { color: colors.primary },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerLow,
    marginTop: 16,
  },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: colors.onBackground, marginBottom: 12 },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: colors.onBackground,
  },
  modalError: { marginTop: 6, fontSize: 12, color: colors.error },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  modalBtn: { paddingVertical: 8, paddingHorizontal: 16 },
  modalBtnText: { fontSize: 14, fontWeight: '800' },
});
