// @v1.5 — 첫 실행 온보딩 (간소화: 한 페이지에서 권한만 요청)
// 흐름: 인사 + 권한 목록 안내 → "허용하고 시작" → 알림/카메라/ATT(/삼성) 팝업 순차 → onboardingCompleted 저장 → Home.
//   소개·기능·튜토리얼 슬라이드 전부 제거. 권한 거부해도 앱은 정상 작동.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, AppState, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CommonActions } from '@react-navigation/native';
import { requestAlarmKitAuthorizationIfNeeded } from '../utils/routineScheduler';
import { isSamsung, openSamsungDeviceCare } from '../utils/oemBatteryHelper';
import { mirrorToBackup } from '../utils/backupRestore';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;
};

type PermissionType = 'att' | 'notification' | 'camera' | 'samsung-battery';

async function requestPermission(permission: PermissionType) {
  try {
    if (permission === 'att') {
      if (Platform.OS !== 'ios') return;
      if (AppState.currentState !== 'active') return;
      const att = require('expo-tracking-transparency');
      const current = await att.getTrackingPermissionsAsync();
      if (current.status === 'undetermined') {
        const result = await att.requestTrackingPermissionsAsync();
        await AsyncStorage.setItem('attStatus', result.status);
      } else {
        await AsyncStorage.setItem('attStatus', current.status);
      }
    } else if (permission === 'notification') {
      // iOS 26+ = AlarmKit framework 자체 권한 요청. iOS 25 이하 = 'unavailable' silent skip.
      await requestAlarmKitAuthorizationIfNeeded();
      await AsyncStorage.setItem('notificationsAsked', 'true');
    } else if (permission === 'camera') {
      const { Camera } = require('react-native-vision-camera');
      const result = await Camera.requestCameraPermission();
      await AsyncStorage.setItem('cameraStatus', result);
      await AsyncStorage.setItem('cameraAsked', 'true');
    } else if (permission === 'samsung-battery') {
      if (Platform.OS !== 'android') return;
      await openSamsungDeviceCare();
      await AsyncStorage.setItem('samsungBatteryAsked', 'true');
    }
  } catch {
    // 환경 미지원 무시 (e.g., Expo Go)
  }
}

export default function OnboardingScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [busy, setBusy] = useState(false);

  // 타자기 효과. revealed = 지금까지 노출된 누적 글자 수. 위→아래 단락 순서로 한 자씩 찍힘.
  const [revealed, setRevealed] = useState(0);
  const revealedRef = useRef(0);
  const totalRef = useRef(0);
  const speedRef = useRef(1); // 화면을 누르고 있으면 배속.
  const startedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);

  const tick = useCallback((ts: number) => {
    if (!lastTsRef.current) lastTsRef.current = ts;
    const dt = (ts - lastTsRef.current) / 1000;
    lastTsRef.current = ts;
    const CHARS_PER_SEC = 75;
    const next = Math.min(totalRef.current, revealedRef.current + dt * CHARS_PER_SEC * speedRef.current);
    revealedRef.current = next;
    setRevealed(next);
    rafRef.current = next < totalRef.current ? requestAnimationFrame(tick) : null;
  }, []);

  const startTyping = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    revealedRef.current = 0;
    lastTsRef.current = 0;
    setRevealed(0);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => {
    // 스플래시→온보딩 화면 전환이 끝난 뒤 시작해야 글자가 찍히는 게 보임.
    const sub = navigation.addListener('transitionEnd', (e: any) => {
      if (!e?.data?.closing) startTyping();
    });
    // 전환 이벤트가 없는 경우 폴백.
    const fallback = setTimeout(startTyping, 600);
    return () => {
      sub();
      clearTimeout(fallback);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [navigation, startTyping]);

  const rows: { key: PermissionType; icon: string; label: string; desc: string }[] = [
    {
      key: 'notification',
      icon: 'notifications-active',
      label: t('onboarding.permRowNotifLabel', { defaultValue: '타이머 종료 알림' }),
      desc: t('onboarding.permRowNotifDesc', { defaultValue: '잠금 화면 알람·루틴 진행에 필요' }),
    },
    {
      key: 'camera',
      icon: 'photo-camera',
      label: t('onboarding.permRowCameraLabel', { defaultValue: '사진 스캔 종료' }),
      desc: t('onboarding.permRowCameraDesc', { defaultValue: '카메라로 사물을 스캔하는 미션에 사용' }),
    },
    {
      key: 'att',
      icon: 'campaign',
      label: t('onboarding.permRowAttLabel', { defaultValue: '맞춤형 광고' }),
      desc: t('onboarding.permRowAttDesc', { defaultValue: '더 적합한 광고 제공 (거부해도 정상 작동)' }),
    },
    ...(isSamsung()
      ? [
          {
            key: 'samsung-battery' as const,
            icon: 'battery-saver',
            label: t('onboarding.permRowSamsungLabel', { defaultValue: '디바이스 케어 설정' }),
            desc: t('onboarding.permRowSamsungDesc', { defaultValue: '"잠자는 앱" 제외 — 알람 차단 방지' }),
          },
        ]
      : []),
  ];

  // 표시 텍스트
  const greeting = t('onboarding.greeting', { defaultValue: '안녕하세요' });
  const intro = t('onboarding.permIntro', { defaultValue: 'ShutTimer를 원활히 쓰려면\n아래 권한이 필요합니다.' });
  const note = t('onboarding.permNote', { defaultValue: '권한을 거부해도 앱은 사용할 수 있어요.' });

  // 위→아래 순서대로 각 텍스트가 시작되는 누적 글자 오프셋 계산.
  const LOGO_LEAD = 3;
  const BUTTON_LEAD = 4;
  let cur = LOGO_LEAD;
  const greetingOff = cur;
  cur += greeting.length;
  const introOff = cur;
  cur += intro.length;
  const rowOffs = rows.map((r) => {
    const labelOff = cur;
    cur += r.label.length;
    const descOff = cur;
    cur += r.desc.length;
    return { labelOff, descOff };
  });
  const noteOff = cur;
  cur += note.length;
  const buttonOff = cur;
  cur += BUTTON_LEAD;
  totalRef.current = cur;

  // 해당 오프셋 기준 지금까지 찍힌 글자 수.
  const typedLen = (off: number, text: string) =>
    Math.max(0, Math.min(text.length, Math.floor(revealed - off)));
  // 텍스트 없는 요소(로고·아이콘·버튼)의 페이드 정도(0~1).
  const fadeOp = (off: number, w = 6) => Math.max(0, Math.min(1, (revealed - off) / w));

  const handleAllowAndStart = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    // 순서대로 네이티브 권한 팝업 요청 (알림 → 카메라 → ATT → [삼성]).
    await requestPermission('notification');
    await requestPermission('camera');
    await requestPermission('att');
    if (isSamsung()) await requestPermission('samsung-battery');

    await AsyncStorage.setItem('onboardingCompleted', 'true');
    // 삭제 후 재설치 복원용 백업 미러.
    mirrorToBackup().catch(() => {});
    navigation.dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: 'Home' }] })
    );
  }, [busy, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      {/* 화면을 누르고 있으면 글자가 더 빨리 찍힘 */}
      <Pressable
        style={styles.flex}
        onPressIn={() => {
          speedRef.current = 4;
        }}
        onPressOut={() => {
          speedRef.current = 1;
        }}
      >
        <View style={styles.content}>
          <View style={[styles.logoWrap, { opacity: fadeOp(0, LOGO_LEAD) }]}>
            <MaterialIcons name="alarm" size={56} color="#ff2424" />
          </View>
          {/* 미노출 글자는 opacity 0 으로 자리만 차지 → 레이아웃 흔들림 없이 한 자씩 노출 */}
          <Text style={styles.greeting}>
            {greeting.slice(0, typedLen(greetingOff, greeting))}
            <Text style={styles.hiddenChar}>{greeting.slice(typedLen(greetingOff, greeting))}</Text>
          </Text>
          <Text style={styles.subtitle}>
            {intro.slice(0, typedLen(introOff, intro))}
            <Text style={styles.hiddenChar}>{intro.slice(typedLen(introOff, intro))}</Text>
          </Text>

          <View style={styles.list}>
            {rows.map((r, i) => (
              <View key={r.key} style={[styles.row, { opacity: fadeOp(rowOffs[i].labelOff) }]}>
                <View style={styles.rowIcon}>
                  <MaterialIcons name={r.icon as any} size={24} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>
                    {r.label.slice(0, typedLen(rowOffs[i].labelOff, r.label))}
                    <Text style={styles.hiddenChar}>{r.label.slice(typedLen(rowOffs[i].labelOff, r.label))}</Text>
                  </Text>
                  <Text style={styles.rowDesc}>
                    {r.desc.slice(0, typedLen(rowOffs[i].descOff, r.desc))}
                    <Text style={styles.hiddenChar}>{r.desc.slice(typedLen(rowOffs[i].descOff, r.desc))}</Text>
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.note}>
            {note.slice(0, typedLen(noteOff, note))}
            <Text style={styles.hiddenChar}>{note.slice(typedLen(noteOff, note))}</Text>
          </Text>
          <View style={[styles.buttonWrap, { opacity: fadeOp(buttonOff, BUTTON_LEAD) }]}>
            <TouchableOpacity
              style={[styles.button, busy && { opacity: 0.6 }]}
              onPress={handleAllowAndStart}
              disabled={busy}
              activeOpacity={0.85}
            >
              <Text style={styles.buttonText}>
                {t('onboarding.permAllowStart', { defaultValue: '허용하고 시작' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Pressable>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flex: {
      flex: 1,
    },
    buttonWrap: {
      alignSelf: 'stretch',
    },
    hiddenChar: {
      opacity: 0,
    },
    content: {
      flex: 1,
      paddingHorizontal: 32,
      justifyContent: 'center',
    },
    logoWrap: {
      alignItems: 'center',
      marginBottom: 20,
    },
    greeting: {
      fontSize: 30,
      fontWeight: '800',
      color: colors.onBackground,
      textAlign: 'center',
      letterSpacing: -0.5,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.secondary,
      textAlign: 'center',
      marginBottom: 32,
    },
    list: {
      gap: 12,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 14,
      backgroundColor: colors.surfaceContainerLow,
    },
    rowIcon: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainerLowest,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowLabel: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.onBackground,
    },
    rowDesc: {
      fontSize: 12,
      color: colors.secondary,
      marginTop: 2,
    },
    footer: {
      paddingHorizontal: 32,
      paddingBottom: 24,
      gap: 12,
      alignItems: 'center',
    },
    note: {
      fontSize: 12,
      color: colors.secondary,
      textAlign: 'center',
    },
    button: {
      backgroundColor: colors.primary,
      paddingVertical: 16,
      borderRadius: 28,
      alignItems: 'center',
      alignSelf: 'stretch',
    },
    buttonText: {
      color: colors.onPrimary,
      fontSize: 17,
      fontWeight: '800',
    },
  });
