// v1.7 — 버그 제보 모달.
// HomeScreen 헤더 측 메일 아이콘 tap → 본 모달 → 사용자 시나리오 + 설명 입력 + 디바이스 정보 자동 첨부 → mailto 측 메일 앱 자동 열림.
// ShutTimer = 서버 ❌ 정합 (= mailto 패턴 = 외부 의존 ❌).

import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Linking,
  Platform,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';

const BUG_REPORT_EMAIL = 'hwan4870a@gmail.com';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function BugReportModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  const [scenario, setScenario] = useState('');
  const [description, setDescription] = useState('');

  const appVersion = Constants.expoConfig?.version ?? '?';
  const platformOS = Platform.OS;
  const platformVer = String(Platform.Version);
  const deviceInfo = `App ${appVersion} / ${platformOS} ${platformVer}`;

  const handleSend = async () => {
    const trimmedScenario = scenario.trim();
    const trimmedDesc = description.trim();
    if (trimmedScenario.length === 0 && trimmedDesc.length === 0) {
      Alert.alert(
        t('home.bugReport.emptyTitle', { defaultValue: '내용 없음' }),
        t('home.bugReport.emptyBody', { defaultValue: '시나리오 또는 설명을 입력해주세요.' }),
      );
      return;
    }

    const subject = t('home.bugReport.mailSubject', { defaultValue: 'ShutTimer 버그 제보' });
    const scenarioLabel = t('home.bugReport.scenarioLabel', { defaultValue: '시나리오' });
    const descLabel = t('home.bugReport.descLabel', { defaultValue: '버그 설명' });
    const deviceLabel = t('home.bugReport.deviceLabel', { defaultValue: '디바이스 정보' });

    const body = `[${scenarioLabel}]\n${trimmedScenario || '-'}\n\n[${descLabel}]\n${trimmedDesc || '-'}\n\n---\n[${deviceLabel}]\n${deviceInfo}\n`;

    const url = `mailto:${BUG_REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    if (!canOpen) {
      Alert.alert(
        t('home.bugReport.errorTitle', { defaultValue: '메일 앱 없음' }),
        t('home.bugReport.errorBody', { defaultValue: '메일 앱이 설정되지 않았습니다. 설정 측 메일 계정 추가 후 재시도 부탁드립니다.' }),
      );
      return;
    }

    await Linking.openURL(url).catch(() => {});
    setScenario('');
    setDescription('');
    onClose();
  };

  const handleCancel = () => {
    setScenario('');
    setDescription('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {t('home.bugReport.title', { defaultValue: '버그 제보' })}
            </Text>
            <TouchableOpacity
              onPress={handleCancel}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="close" size={24} color={colors.onBackground} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.body}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <Text style={styles.label}>
              {t('home.bugReport.scenarioLabel', { defaultValue: '시나리오' })}
            </Text>
            <TextInput
              style={styles.input}
              value={scenario}
              onChangeText={setScenario}
              placeholder={t('home.bugReport.scenarioPlaceholder', {
                defaultValue: '어떤 상황에서 발생했나요?',
              })}
              placeholderTextColor={colors.outlineVariant}
              multiline
              maxLength={500}
            />

            <Text style={styles.label}>
              {t('home.bugReport.descLabel', { defaultValue: '버그 설명' })}
            </Text>
            <TextInput
              style={[styles.input, styles.inputLarge]}
              value={description}
              onChangeText={setDescription}
              placeholder={t('home.bugReport.descPlaceholder', {
                defaultValue: '무엇이 잘못됐나요? 기대 동작 + 실제 동작 영역 작성 부탁드립니다.',
              })}
              placeholderTextColor={colors.outlineVariant}
              multiline
              maxLength={2000}
            />

            <Text style={styles.deviceInfo}>
              {t('home.bugReport.deviceInfoLabel', { defaultValue: '자동 첨부' })}: {deviceInfo}
            </Text>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
              <Text style={styles.cancelText}>
                {t('common.cancel', { defaultValue: '취소' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
              <Text style={styles.sendText}>
                {t('home.bugReport.send', { defaultValue: '보내기' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    card: {
      width: '100%',
      maxWidth: 480,
      maxHeight: '85%',
      backgroundColor: colors.background,
      borderRadius: 14,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.outlineVariant,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.onBackground,
    },
    body: {
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 16,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.secondary,
      marginTop: 16,
      marginBottom: 6,
    },
    input: {
      fontSize: 15,
      color: colors.onBackground,
      backgroundColor: colors.surfaceContainerLow,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      minHeight: 60,
      textAlignVertical: 'top',
    },
    inputLarge: {
      minHeight: 120,
    },
    deviceInfo: {
      fontSize: 12,
      color: colors.secondary,
      marginTop: 16,
      fontStyle: 'italic',
    },
    footer: {
      flexDirection: 'row',
      borderTopWidth: 0.5,
      borderTopColor: colors.outlineVariant,
    },
    cancelBtn: {
      flex: 1,
      paddingVertical: 14,
      alignItems: 'center',
      borderRightWidth: 0.5,
      borderRightColor: colors.outlineVariant,
    },
    cancelText: {
      fontSize: 15,
      color: colors.secondary,
      fontWeight: '500',
    },
    sendBtn: {
      flex: 1,
      paddingVertical: 14,
      alignItems: 'center',
    },
    sendText: {
      fontSize: 15,
      color: colors.primary,
      fontWeight: '700',
    },
  });
