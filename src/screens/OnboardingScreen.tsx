// @v1.5 — 첫 실행 온보딩 화면
// 흐름: Welcome → 기능 소개 3개 → 권한 priming 3개 (ATT/위치/알림) → 시작하기
// 권한 priming 패턴: 자체 설명 화면 → "허용" 버튼 → iOS native popup
// AsyncStorage 'onboardingCompleted' = 'true' 저장 후 Home으로 이동

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Dimensions,
  AppState,
  Platform,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CommonActions } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { useTranslation } from 'react-i18next';
import Svg, { Circle as SvgCircle, Path as SvgPath, Defs, ClipPath, Rect as SvgRect } from 'react-native-svg';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import TimerDial from '../components/TimerDial';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;
};

type PermissionType = 'att' | 'location' | 'notification' | 'camera';

type Card = { icon: string; label: string; description: string };

type Slide =
  | { kind: 'greeting'; text: string }
  | { kind: 'welcome'; title: string }
  | { kind: 'feature-anim'; icon: string; title: string; body: string }
  | { kind: 'feature-cards'; title: string; cards: Card[] }
  | { kind: 'feature'; icon: string; title: string; body: string }
  | {
      kind: 'permission';
      permission: PermissionType;
      icon: string;
      title: string;
      body: string;
      buttonLabel: string;
    };

const { width: SCREEN_W } = Dimensions.get('window');

export default function OnboardingScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  // RTL 언어 (아랍어) 감지 — 마스크 reveal 방향 반전용
  const isRTL = i18n.language === 'ar';
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const scrollRef = useRef<ScrollView>(null);
  const [currentPage, setCurrentPage] = useState(0);
  // 페이지별 애니메이션 완료 여부 — true면 이동 버튼 노출
  const [pageAnimComplete, setPageAnimComplete] = useState<Record<number, boolean>>({});
  const markPageComplete = useCallback((idx: number) => {
    setPageAnimComplete((prev) => (prev[idx] ? prev : { ...prev, [idx]: true }));
  }, []);

  // 슬라이드 정의 — 마지막 "시작하기" 슬라이드는 별도 처리
  const slides: Slide[] = [
    {
      kind: 'greeting',
      text: t('onboarding.greeting', { defaultValue: '안녕하세요.' }),
    },
    {
      kind: 'welcome',
      // \n으로 명시 줄바꿈 — 한 줄씩 reveal
      title: t('onboarding.welcomeTitle', { defaultValue: 'ShutTimer에 오신 것을\n환영합니다' }),
    },
    {
      kind: 'feature-anim',
      icon: 'timer',
      title: t('onboarding.feature1Title', { defaultValue: '타이머와 알람' }),
      // \n으로 명시 줄바꿈 — "세요" 분리 방지 + 한 줄씩 reveal
      body: t('onboarding.feature1Body', { defaultValue: '원하는 시간을 설정하고\n나만의 루틴을 만들어보세요' }),
    },
    {
      kind: 'feature-anim',
      icon: 'photo-camera',
      title: t('onboarding.feature2Title', { defaultValue: '사진 스캔으로 타이머 종료' }),
      body: t('onboarding.feature2Body', { defaultValue: '카메라로 사물을 스캔하면\n타이머가 종료됩니다.' }),
    },
    {
      kind: 'feature-cards',
      title: t('onboarding.feature3Title', { defaultValue: '다양한 종료 방식' }),
      cards: [
        {
          icon: 'photo-camera',
          label: t('onboarding.cardCameraLabel', { defaultValue: '사진 스캔' }),
          description: t('onboarding.cardCameraDesc', { defaultValue: '카메라로 사물을 스캔하여 종료' }),
        },
        {
          icon: 'vibration',
          label: t('onboarding.cardShakeLabel', { defaultValue: '흔들기' }),
          description: t('onboarding.cardShakeDesc', { defaultValue: '기기를 흔들어 종료' }),
        },
        {
          icon: 'touch-app',
          label: t('onboarding.cardTapLabel', { defaultValue: '탭' }),
          description: t('onboarding.cardTapDesc', { defaultValue: '버튼을 눌러 종료' }),
        },
      ],
    },
    {
      kind: 'permission',
      permission: 'att',
      icon: 'campaign',
      title: t('onboarding.permissionAttTitle', { defaultValue: '맞춤형 광고로 무료 유지' }),
      body: t('onboarding.permissionAttBody', { defaultValue: '더 적합한 광고를 위해\n추적 권한이 필요합니다.\n거부해도 앱은 정상 작동합니다.' }),
      buttonLabel: t('onboarding.permissionAttButton', { defaultValue: '계속' }),
    },
    {
      kind: 'permission',
      permission: 'location',
      icon: 'place',
      title: t('onboarding.permissionLocationTitle', { defaultValue: '지역 광고로 더 나은 경험' }),
      body: t('onboarding.permissionLocationBody', { defaultValue: '위치 정보로 더 적합한\n광고를 제공합니다.\n거부해도 앱은 정상 작동합니다.' }),
      buttonLabel: t('onboarding.permissionLocationButton', { defaultValue: '계속' }),
    },
    {
      kind: 'permission',
      permission: 'notification',
      icon: 'notifications-active',
      title: t('onboarding.permissionNotifTitle', { defaultValue: '타이머 종료 알림' }),
      body: t('onboarding.permissionNotifBody', { defaultValue: '잠금 화면에서 타이머 종료를\n받으려면 알림 권한이 필요합니다.\n루틴 진행에 필수입니다.' }),
      buttonLabel: t('onboarding.permissionNotifButton', { defaultValue: '계속' }),
    },
  ];

  const totalPages = slides.length + 2; // +2: 준비 완료 슬라이드 + home-preview 슬라이드

  const goToPage = (idx: number) => {
    scrollRef.current?.scrollTo({ x: idx * SCREEN_W, animated: true });
  };

  // feature-cards(다양한 종료 방식) → next 시 카메라 권한 요청 (한 번만)
  const cameraAskedRef = useRef(false);
  const triggerCameraIfLeavingCards = (fromPage: number) => {
    if (cameraAskedRef.current) return;
    if (slides[fromPage]?.kind !== 'feature-cards') return;
    cameraAskedRef.current = true;
    requestPermission('camera');
  };

  const handleNext = () => {
    triggerCameraIfLeavingCards(currentPage);
    if (currentPage < totalPages - 1) {
      goToPage(currentPage + 1);
    }
  };

  // greeting 슬라이드 — 글자별 fade-in stagger + loop (글씨쓰듯 부드럽게)
  const greetingFull = slides[0].kind === 'greeting' ? slides[0].text : '';
  const charAnimsRef = useRef<Animated.Value[]>([]);
  if (charAnimsRef.current.length !== greetingFull.length) {
    charAnimsRef.current = greetingFull.split('').map(() => new Animated.Value(0));
  }

  // welcome 슬라이드 (page 1) — 로고 fade-in → 줄별 좌→우 reveal (1회)
  const welcomeFull = slides[1]?.kind === 'welcome' ? slides[1].title : '';
  const welcomeLines = welcomeFull.split('\n');
  const [welcomeLineWidths, setWelcomeLineWidths] = useState<number[]>([]);
  const welcomeLogoOpacity = useRef(new Animated.Value(0)).current;
  const welcomeLineMasksRef = useRef<Animated.Value[]>([]);
  if (welcomeLineMasksRef.current.length !== welcomeLines.length) {
    welcomeLineMasksRef.current = welcomeLines.map(() => new Animated.Value(0));
  }

  // feature-anim 슬라이드 — 별도 컴포넌트로 추출 (FeatureAnimSlide). 여러 페이지 지원.

  // greeting fade-in stagger 루프 (천천히) — 첫 사이클 완료 시 이동 버튼 활성화
  useEffect(() => {
    if (currentPage !== 0) return;
    const anims = charAnimsRef.current;
    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const run = (isFirst: boolean) => {
      if (stopped) return;
      anims.forEach((a) => a.setValue(0));
      Animated.stagger(
        280,
        anims.map((a) =>
          Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: true })
        )
      ).start(({ finished }) => {
        if (!finished || stopped) return;
        if (isFirst) markPageComplete(0); // 첫 사이클 완료 → 이동 버튼 활성
        timeoutId = setTimeout(() => run(false), 1800);
      });
    };
    run(true);
    return () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
      anims.forEach((a) => a.stopAnimation());
    };
  }, [currentPage, greetingFull, markPageComplete]);

  // welcome 시퀀스: 로고 fade-in → 줄별 좌→우 reveal 순차 (1회, 재진입 시 스냅)
  const welcomePlayedRef = useRef(false);
  useEffect(() => {
    if (currentPage !== 1) return;
    if (welcomeLineWidths.length !== welcomeLines.length) return;
    if (welcomeLineWidths.some((w) => !w || w === 0)) return;

    if (welcomePlayedRef.current) {
      welcomeLogoOpacity.setValue(1);
      welcomeLineMasksRef.current.forEach((m, i) => m.setValue(welcomeLineWidths[i]));
      markPageComplete(1);
      return;
    }

    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    welcomeLogoOpacity.setValue(0);
    welcomeLineMasksRef.current.forEach((m) => m.setValue(0));

    const animateLine = (idx: number) => {
      if (stopped) return;
      if (idx >= welcomeLines.length) {
        markPageComplete(1); // 모든 줄 완료 → 이동 버튼 활성
        return;
      }
      const anim = welcomeLineMasksRef.current[idx];
      const target = welcomeLineWidths[idx];
      Animated.timing(anim, {
        toValue: target,
        duration: 1500,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (!finished || stopped) return;
        timeoutId = setTimeout(() => animateLine(idx + 1), 400);
      });
    };

    Animated.timing(welcomeLogoOpacity, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || stopped) return;
      timeoutId = setTimeout(() => animateLine(0), 300);
    });

    return () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
      welcomeLogoOpacity.stopAnimation();
      welcomeLineMasksRef.current.forEach((m) => m.stopAnimation());
      welcomePlayedRef.current = true;
    };
  }, [currentPage, welcomeLineWidths, welcomeLines.length, welcomeLogoOpacity, markPageComplete]);

  const handleStart = useCallback(async () => {
    await AsyncStorage.setItem('onboardingCompleted', 'true');
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      })
    );
  }, [navigation]);

  // HomePreview 확인 버튼 — ReadySlide(마지막 시작하기 페이지)로 swipe
  const handleHomePreviewAdvance = useCallback(() => {
    scrollRef.current?.scrollTo({ x: (totalPages - 1) * SCREEN_W, animated: true });
  }, [totalPages]);

  const requestPermission = useCallback(async (permission: PermissionType) => {
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
      } else if (permission === 'location') {
        const Location = require('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        await AsyncStorage.setItem('locationStatus', status);
        await AsyncStorage.setItem('locationAsked', 'true');
      } else if (permission === 'notification') {
        await Notifications.requestPermissionsAsync();
        await AsyncStorage.setItem('notificationsAsked', 'true');
      } else if (permission === 'camera') {
        const { Camera } = require('react-native-vision-camera');
        const result = await Camera.requestCameraPermission();
        await AsyncStorage.setItem('cameraStatus', result);
        await AsyncStorage.setItem('cameraAsked', 'true');
      }
    } catch (e) {
      // 환경 미지원 무시 (e.g., Expo Go)
    }
  }, []);

  const handlePermissionContinue = async (permission: PermissionType) => {
    await requestPermission(permission);
    handleNext();
  };

  const onScroll = (e: any) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const page = Math.round(offsetX / SCREEN_W);
    if (page !== currentPage) {
      // feature-cards → 다음 페이지 전환 시 카메라 권한 요청
      if (page > currentPage) triggerCameraIfLeavingCards(currentPage);
      setCurrentPage(page);
    }
  };

  // 스크롤 위치 추적 — HomePreview 진입 시 chrome(상단 nav + 하단 dots) 부드럽게 fade-out.
  // HomePreview는 slides.length 위치 (마지막은 ReadySlide). HomePreview에서만 chrome 0, 앞뒤에서는 1.
  const scrollXAnim = useRef(new Animated.Value(0)).current;
  const chromeOpacity = scrollXAnim.interpolate({
    inputRange: [
      (slides.length - 1) * SCREEN_W,
      slides.length * SCREEN_W,
      (slides.length + 1) * SCREEN_W,
    ],
    outputRange: [1, 0, 1],
    extrapolate: 'clamp',
  });

  // 다음 버튼 노출: 일반 슬라이드만 (HomePreview=확인 버튼, ReadySlide=시작하기 버튼으로 자체 이동)
  const isNextButtonSlide =
    slides[currentPage]?.kind === 'greeting' ||
    slides[currentPage]?.kind === 'welcome' ||
    slides[currentPage]?.kind === 'feature' ||
    slides[currentPage]?.kind === 'feature-anim' ||
    slides[currentPage]?.kind === 'feature-cards';

  // 현재 페이지 애니메이션 완료 여부 (이동 버튼 가드). 모든 슬라이드는 자체 onComplete 호출.
  const isCurrentPageAnimComplete = pageAnimComplete[currentPage] === true;
  const isLastSlide = currentPage === totalPages - 1;

  const handlePrev = () => {
    if (currentPage > 0) goToPage(currentPage - 1);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 상단 네비게이션 — HomePreview 진입 시 스크롤과 동기화 fade-out */}
      <Animated.View
        style={[styles.topNav, { opacity: chromeOpacity }]}
        pointerEvents={currentPage === slides.length ? 'none' : 'box-none'}
      >
        <View style={{ width: 44 }}>
          {currentPage > 0 && isCurrentPageAnimComplete && (
            <TouchableOpacity
              onPress={handlePrev}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.topNavBtn}
            >
              <MaterialIcons name="chevron-left" size={32} color={colors.secondary} />
            </TouchableOpacity>
          )}
        </View>
        <View style={{ width: 44, alignItems: 'flex-end' }}>
          {isNextButtonSlide && isCurrentPageAnimComplete && (
            <TouchableOpacity
              onPress={handleNext}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.topNavBtn}
            >
              <MaterialIcons name="chevron-right" size={32} color={colors.secondary} />
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollXAnim } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
        scrollEnabled={(isNextButtonSlide && isCurrentPageAnimComplete) || isLastSlide}
      >
        {slides.map((slide, idx) => {
          if (slide.kind === 'greeting') {
            return (
              <View key={idx} style={styles.slide}>
                <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                  {greetingFull.split('').map((ch, i) => (
                    <Animated.Text
                      key={i}
                      style={[
                        styles.greetingText,
                        {
                          opacity: charAnimsRef.current[i] ?? 0,
                          transform: [
                            {
                              translateY: (charAnimsRef.current[i] ?? new Animated.Value(0)).interpolate({
                                inputRange: [0, 1],
                                outputRange: [8, 0],
                              }),
                            },
                          ],
                        },
                      ]}
                    >
                      {ch}
                    </Animated.Text>
                  ))}
                </View>
              </View>
            );
          }
          if (slide.kind === 'welcome') {
            return (
              <View key={idx} style={styles.slide}>
                {/* 로고 — 부드럽게 fade-in (사이즈 +5px) */}
                <Animated.View style={{ marginBottom: 24, opacity: welcomeLogoOpacity }}>
                  <MaterialIcons name="alarm" size={61} color="#ff2424" />
                </Animated.View>
                {/* 텍스트 — 줄별 좌→우 reveal */}
                <View style={{ alignItems: 'center' }}>
                  {welcomeLines.map((line, lineIdx) => (
                    <View key={lineIdx} style={{ position: 'relative', marginVertical: 2 }}>
                      <Text
                        style={[styles.welcomeText, { textAlign: 'center' }]}
                        onLayout={(e) => {
                          const w = e.nativeEvent.layout.width;
                          setWelcomeLineWidths((prev) => {
                            if (prev[lineIdx] === w) return prev;
                            const next = [...prev];
                            next[lineIdx] = w;
                            return next;
                          });
                        }}
                      >
                        {line}
                      </Text>
                      <Animated.View
                        pointerEvents="none"
                        style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          ...(isRTL
                            ? { left: 0, right: welcomeLineMasksRef.current[lineIdx] ?? 0 }
                            : { left: welcomeLineMasksRef.current[lineIdx] ?? 0, right: 0 }),
                          backgroundColor: colors.background,
                        }}
                      />
                    </View>
                  ))}
                </View>
              </View>
            );
          }
          if (slide.kind === 'feature-anim') {
            return (
              <FeatureAnimSlide
                key={idx}
                active={currentPage === idx}
                icon={slide.icon}
                title={slide.title}
                body={slide.body}
                colors={colors}
                styles={styles}
                isRTL={isRTL}
                onComplete={() => markPageComplete(idx)}
              />
            );
          }
          if (slide.kind === 'feature-cards') {
            return (
              <FeatureCardsSlide
                key={idx}
                active={currentPage === idx}
                title={slide.title}
                cards={slide.cards}
                colors={colors}
                styles={styles}
                onComplete={() => markPageComplete(idx)}
              />
            );
          }
          if (slide.kind === 'permission') {
            return (
              <PermissionAnimSlide
                key={idx}
                active={currentPage === idx}
                icon={slide.icon}
                title={slide.title}
                body={slide.body}
                buttonLabel={slide.buttonLabel}
                onPress={() => handlePermissionContinue(slide.permission)}
                colors={colors}
                styles={styles}
                isRTL={isRTL}
                onComplete={() => markPageComplete(idx)}
              />
            );
          }
          // feature (legacy fallback — 현재 사용 슬라이드 없음)
          return (
            <View key={idx} style={styles.slide}>
              <View style={styles.iconWrap}>
                <MaterialIcons name={slide.icon as any} size={120} color={colors.primary} />
              </View>
              <Text style={styles.title}>{slide.title}</Text>
              <Text style={styles.body}>{slide.body}</Text>
            </View>
          );
        })}

        {/* Home Preview — 튜토리얼 (확인 버튼 → ReadySlide로 swipe) */}
        <HomePreviewSlide
          active={currentPage === slides.length}
          colors={colors}
          styles={styles}
          onStart={handleHomePreviewAdvance}
          startLabel={t('onboarding.start', { defaultValue: '시작하기' })}
          favLabel={t('home.favorites', { defaultValue: 'Favorites' })}
          addLabel={t('home.add', { defaultValue: 'Add' })}
          minutesLabel={t('home.minutes', { defaultValue: 'MINUTES' })}
          tooltipPlayLabel={t('onboarding.tooltipPlay', { defaultValue: '재생 버튼을 길게 누르면 타이머를 정지할 수 있습니다' })}
          tooltipFavLabel={t('onboarding.tooltipFav', { defaultValue: '즐겨찾기를 길게 누르면 편집할 수 있습니다' })}
          confirmLabel={t('onboarding.confirm', { defaultValue: '확인' })}
          onComplete={() => markPageComplete(slides.length)}
        />

        {/* 마지막 — 준비 완료 + 시작하기 버튼 → Home 이동 */}
        <ReadySlide
          active={currentPage === totalPages - 1}
          title={t('onboarding.readyTitle', { defaultValue: '준비 완료!' })}
          body={t('onboarding.readyBody', { defaultValue: '이제 ShutTimer를 사용하세요' })}
          buttonLabel={t('onboarding.start', { defaultValue: '시작하기' })}
          onPress={handleStart}
          colors={colors}
          styles={styles}
          onComplete={() => markPageComplete(totalPages - 1)}
        />
      </ScrollView>

      {/* 점 인디케이터 — HomePreview 진입 시 스크롤과 동기화 fade-out */}
      <Animated.View
        style={[styles.bottomBar, { opacity: chromeOpacity }]}
        pointerEvents={currentPage === slides.length ? 'none' : 'box-none'}
      >
        <View style={styles.dots}>
          {Array.from({ length: totalPages }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i === currentPage ? colors.primary : colors.outlineVariant },
              ]}
            />
          ))}
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

// feature-anim 슬라이드 — icon+title fade-in → body 줄별 좌→우 reveal (1회).
// 각 페이지마다 독립 anim refs 사용 (여러 feature-anim 페이지 지원).
function FeatureAnimSlide({
  active,
  icon,
  title,
  body,
  colors,
  styles,
  isRTL,
  onComplete,
}: {
  active: boolean;
  icon: string;
  title: string;
  body: string;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  isRTL: boolean;
  onComplete: () => void;
}) {
  const lines = useMemo(() => body.split('\n'), [body]);
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const lineMasksRef = useRef<Animated.Value[]>([]);
  if (lineMasksRef.current.length !== lines.length) {
    lineMasksRef.current = lines.map(() => new Animated.Value(0));
  }
  const [lineWidths, setLineWidths] = useState<number[]>([]);
  const playedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    if (lineWidths.length !== lines.length) return;
    if (lineWidths.some((w) => !w || w === 0)) return;

    if (playedRef.current) {
      headerOpacity.setValue(1);
      lineMasksRef.current.forEach((m, i) => m.setValue(lineWidths[i]));
      onComplete();
      return;
    }

    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    headerOpacity.setValue(0);
    lineMasksRef.current.forEach((m) => m.setValue(0));

    const animateLine = (idx: number) => {
      if (stopped) return;
      if (idx >= lines.length) {
        onComplete(); // 모든 줄 완료 → 이동 버튼 활성
        return;
      }
      Animated.timing(lineMasksRef.current[idx], {
        toValue: lineWidths[idx],
        duration: 1500,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (!finished || stopped) return;
        timeoutId = setTimeout(() => animateLine(idx + 1), 400);
      });
    };

    Animated.timing(headerOpacity, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || stopped) return;
      timeoutId = setTimeout(() => animateLine(0), 300);
    });

    return () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
      headerOpacity.stopAnimation();
      lineMasksRef.current.forEach((m) => m.stopAnimation());
      playedRef.current = true;
    };
  }, [active, lineWidths, lines, headerOpacity, onComplete]);

  return (
    <View style={styles.slide}>
      <Animated.View style={{ alignItems: 'center', opacity: headerOpacity }}>
        <View style={styles.iconWrap}>
          <MaterialIcons name={icon as any} size={120} color={colors.primary} />
        </View>
        <Text style={styles.title}>{title}</Text>
      </Animated.View>
      <View style={{ marginTop: 8, alignItems: 'center' }}>
        {lines.map((line, lineIdx) => (
          <View key={lineIdx} style={{ position: 'relative', marginVertical: 2 }}>
            <Text
              style={[styles.body, { textAlign: 'center', marginBottom: 0 }]}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                setLineWidths((prev) => {
                  if (prev[lineIdx] === w) return prev;
                  const next = [...prev];
                  next[lineIdx] = w;
                  return next;
                });
              }}
            >
              {line}
            </Text>
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                ...(isRTL
                  ? { left: 0, right: lineMasksRef.current[lineIdx] ?? 0 }
                  : { left: lineMasksRef.current[lineIdx] ?? 0, right: 0 }),
                backgroundColor: colors.background,
              }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

// permission 슬라이드 — icon+title fade-in → body 줄별 reveal → 버튼 fade-in (1회)
function PermissionAnimSlide({
  active,
  icon,
  title,
  body,
  buttonLabel,
  onPress,
  colors,
  styles,
  isRTL,
  onComplete,
}: {
  active: boolean;
  icon: string;
  title: string;
  body: string;
  buttonLabel: string;
  onPress: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  isRTL: boolean;
  onComplete: () => void;
}) {
  const lines = useMemo(() => body.split('\n'), [body]);
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;
  const lineMasksRef = useRef<Animated.Value[]>([]);
  if (lineMasksRef.current.length !== lines.length) {
    lineMasksRef.current = lines.map(() => new Animated.Value(0));
  }
  const [lineWidths, setLineWidths] = useState<number[]>([]);
  const playedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    if (lineWidths.length !== lines.length) return;
    if (lineWidths.some((w) => !w || w === 0)) return;

    if (playedRef.current) {
      headerOpacity.setValue(1);
      lineMasksRef.current.forEach((m, i) => m.setValue(lineWidths[i]));
      buttonOpacity.setValue(1);
      onComplete();
      return;
    }

    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    headerOpacity.setValue(0);
    lineMasksRef.current.forEach((m) => m.setValue(0));
    buttonOpacity.setValue(0);

    const showButton = () => {
      if (stopped) return;
      Animated.timing(buttonOpacity, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && !stopped) onComplete();
      });
    };

    const animateLine = (idx: number) => {
      if (stopped) return;
      if (idx >= lines.length) {
        // 모든 줄 reveal 완료 → 버튼 fade-in
        timeoutId = setTimeout(showButton, 300);
        return;
      }
      Animated.timing(lineMasksRef.current[idx], {
        toValue: lineWidths[idx],
        duration: 1500,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (!finished || stopped) return;
        timeoutId = setTimeout(() => animateLine(idx + 1), 400);
      });
    };

    Animated.timing(headerOpacity, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || stopped) return;
      timeoutId = setTimeout(() => animateLine(0), 300);
    });

    return () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
      headerOpacity.stopAnimation();
      lineMasksRef.current.forEach((m) => m.stopAnimation());
      buttonOpacity.stopAnimation();
      playedRef.current = true;
    };
  }, [active, lineWidths, lines, headerOpacity, buttonOpacity, onComplete]);

  return (
    <View style={styles.slide}>
      <Animated.View style={{ alignItems: 'center', opacity: headerOpacity }}>
        <View style={styles.iconWrap}>
          <MaterialIcons name={icon as any} size={120} color={colors.primary} />
        </View>
        <Text style={styles.title}>{title}</Text>
      </Animated.View>
      <View style={{ marginTop: 8, alignItems: 'center' }}>
        {lines.map((line, lineIdx) => (
          <View key={lineIdx} style={{ position: 'relative', marginVertical: 2 }}>
            <Text
              style={[styles.body, { textAlign: 'center', marginBottom: 0 }]}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                setLineWidths((prev) => {
                  if (prev[lineIdx] === w) return prev;
                  const next = [...prev];
                  next[lineIdx] = w;
                  return next;
                });
              }}
            >
              {line}
            </Text>
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                ...(isRTL
                  ? { left: 0, right: lineMasksRef.current[lineIdx] ?? 0 }
                  : { left: lineMasksRef.current[lineIdx] ?? 0, right: 0 }),
                backgroundColor: colors.background,
              }}
            />
          </View>
        ))}
      </View>
      <Animated.View style={{ opacity: buttonOpacity, marginTop: 24 }}>
        <TouchableOpacity style={styles.permissionButton} onPress={onPress}>
          <Text style={styles.permissionButtonText}>{buttonLabel}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// 준비 완료 슬라이드 — icon → title → body → 시작하기 버튼 순차 fade-in (1회, 재진입 시 스냅)
function ReadySlide({
  active,
  title,
  body,
  buttonLabel,
  onPress,
  colors,
  styles,
  onComplete,
}: {
  active: boolean;
  title: string;
  body: string;
  buttonLabel: string;
  onPress: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  onComplete: () => void;
}) {
  const iconOp = useRef(new Animated.Value(0)).current;
  const titleOp = useRef(new Animated.Value(0)).current;
  const bodyOp = useRef(new Animated.Value(0)).current;
  const buttonOp = useRef(new Animated.Value(0)).current;
  const playedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    if (playedRef.current) {
      iconOp.setValue(1);
      titleOp.setValue(1);
      bodyOp.setValue(1);
      buttonOp.setValue(1);
      onComplete();
      return;
    }
    let stopped = false;
    iconOp.setValue(0);
    titleOp.setValue(0);
    bodyOp.setValue(0);
    buttonOp.setValue(0);

    Animated.sequence([
      Animated.timing(iconOp, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(titleOp, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(bodyOp, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(buttonOp, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished && !stopped) onComplete();
    });

    return () => {
      stopped = true;
      iconOp.stopAnimation();
      titleOp.stopAnimation();
      bodyOp.stopAnimation();
      buttonOp.stopAnimation();
      playedRef.current = true;
    };
  }, [active, iconOp, titleOp, bodyOp, buttonOp, onComplete]);

  return (
    <View style={styles.slide}>
      <Animated.View style={{ opacity: iconOp }}>
        <View style={styles.iconWrap}>
          <MaterialIcons name="check-circle" size={120} color={colors.primary} />
        </View>
      </Animated.View>
      <Animated.Text style={[styles.title, { opacity: titleOp }]}>{title}</Animated.Text>
      <Animated.Text style={[styles.body, { opacity: bodyOp }]}>{body}</Animated.Text>
      <Animated.View style={{ opacity: buttonOp }}>
        <TouchableOpacity style={styles.startButton} onPress={onPress}>
          <Text style={styles.startButtonText}>{buttonLabel}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// 즐겨찾기 long-press 게이지 sector path (MissionItem과 동일 스펙, 60x60 icon 기준)
function getFavSectorPath(progress: number): string {
  const cx = 30, cy = 30, r = 55;
  if (progress <= 0) return '';
  if (progress >= 0.999) return `M ${cx} ${cy} m 0 ${-r} a ${r} ${r} 0 1 1 0.001 0 Z`;
  const endAngle = progress * 360;
  const rad = (endAngle - 90) * (Math.PI / 180);
  const endX = cx + r * Math.cos(rad);
  const endY = cy + r * Math.sin(rad);
  const largeArc = endAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY} Z`;
}

// home-preview 슬라이드 — HomeScreen 비주얼 그대로 복제 (기능 없음, TV 즐겨찾기 1개 추가)
function HomePreviewSlide({
  active,
  colors,
  styles,
  onComplete,
  onStart,
  startLabel,
  favLabel,
  addLabel,
  minutesLabel,
  tooltipPlayLabel,
  tooltipFavLabel,
  confirmLabel,
}: {
  active: boolean;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  onComplete: () => void;
  onStart: () => void;
  startLabel: string;
  favLabel: string;
  addLabel: string;
  minutesLabel: string;
  tooltipPlayLabel: string;
  tooltipFavLabel: string;
  confirmLabel: string;
}) {
  // 시퀀스 애니메이션: play tooltip → fav tooltip → 확인 버튼 순차 fade-in
  const playTooltipOp = useRef(new Animated.Value(0)).current;
  const favTooltipOp = useRef(new Animated.Value(0)).current;
  const confirmOp = useRef(new Animated.Value(0)).current;
  const playedRef = useRef(false);
  // onComplete를 ref로 — parent re-render로 인한 useEffect 재실행 방지
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!active) return;
    if (playedRef.current) {
      playTooltipOp.setValue(1);
      favTooltipOp.setValue(1);
      confirmOp.setValue(1);
      onCompleteRef.current();
      return;
    }
    let stopped = false;
    playTooltipOp.setValue(0);
    favTooltipOp.setValue(0);
    confirmOp.setValue(0);

    const animation = Animated.sequence([
      Animated.timing(playTooltipOp, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.delay(500),
      Animated.timing(favTooltipOp, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.delay(500),
      Animated.timing(confirmOp, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => {
      if (finished && !stopped) {
        playedRef.current = true;
        onCompleteRef.current();
      }
    });
    return () => {
      stopped = true;
      animation.stop();
    };
  }, [active, playTooltipOp, favTooltipOp, confirmOp]);

  // 13분 진행 중(일시정지 상태) 시각
  const timeText = '13:00';
  const dialProgress = 13 / 60;

  return (
    // marginTop: -48 — onboarding topNav 공간 상쇄 (실제 Home 화면처럼 SafeArea 바로 아래에서 시작)
    <View style={[styles.slide, { paddingHorizontal: 0, justifyContent: 'flex-start', paddingTop: 0, paddingBottom: 0, marginTop: -48 }]}>
      <View pointerEvents="none" style={{ width: '100%', flex: 1 }}>
        {/* Header — HomeScreen 동일 구조 */}
        <View style={hp.header}>
          <View style={hp.headerLeft}>
            <MaterialIcons name="timer" size={24} color={colors.primary} />
            <Text style={[hp.headerTitle, { color: colors.onBackground }]}>ShutTimer</Text>
          </View>
          <View style={hp.headerRight}>
            <MaterialIcons name="notifications" size={24} color={colors.secondary} style={{ opacity: 0.4 }} />
            <MaterialIcons name="calendar-today" size={24} color={colors.onBackground} style={{ opacity: 0.6 }} />
            <MaterialIcons name="settings" size={24} color={colors.onBackground} style={{ opacity: 0.6 }} />
          </View>
        </View>

        {/* Dial — TimerDial 직접 사용 (정적, onSeek 미전달, 13분 위치) */}
        <View style={hp.dialSection}>
          <TimerDial
            progress={dialProgress}
            timeText={timeText}
            subText={minutesLabel}
          />

          {/* 다이얼 전환 버튼 모양 (정적) */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12 }}>
            <MaterialIcons name="chevron-left" size={32} color={colors.secondary} />
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary }} />
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.outlineVariant }} />
            </View>
            <MaterialIcons name="chevron-right" size={32} color={colors.secondary} />
          </View>
        </View>

        {/* 13:00 pill + Pause button + 게이지바 링 (long-press 취소 indicator 배경) */}
        <View style={{ alignItems: 'center', justifyContent: 'center', marginBottom: 6, gap: 8 }}>
          <View style={{ borderWidth: 2, borderColor: colors.outlineVariant, borderRadius: 50, paddingHorizontal: 24, paddingVertical: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: colors.onBackground, letterSpacing: 1 }}>
              13 : 00
            </Text>
          </View>
          <View style={{ width: 80, height: 80, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={80} height={80} style={{ position: 'absolute' }}>
              <SvgCircle
                cx={40}
                cy={40}
                r={38}
                fill="none"
                stroke={colors.outlineVariant}
                strokeWidth={3}
                opacity={0.8}
              />
              <SvgCircle
                cx={40}
                cy={40}
                r={38}
                fill="none"
                stroke={colors.primary}
                strokeWidth={3}
                strokeDasharray={2 * Math.PI * 38}
                strokeDashoffset={2 * Math.PI * 38 * 0.5}
                strokeLinecap="round"
                rotation="-90"
                origin="40, 40"
              />
            </Svg>
            <View style={[hp.playButton, { backgroundColor: colors.primary }]}>
              <MaterialIcons name="pause" size={40} color={colors.onPrimary} />
            </View>
          </View>
        </View>

        {/* Favorites — HomeScreen 동일 (TV 1개), 좌측 정렬 */}
        <View style={{ width: '100%', marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, width: '100%' }}>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.outlineVariant }} />
            <Text style={[hp.favTitle, { color: colors.onBackground }]}>{favLabel}</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.outlineVariant }} />
          </View>
          <View style={hp.missionList}>
            <View style={hp.missionItem}>
              <View style={[hp.addBtn, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.secondary }]}>
                <MaterialIcons name="add" size={26} color={colors.secondary} />
              </View>
              <Text style={[hp.missionLabel, { color: colors.secondary }]}>{addLabel}</Text>
            </View>
            <View style={hp.missionItem}>
              <View style={[hp.missionIcon, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.primary }]}>
                <Svg width={60} height={60} style={StyleSheet.absoluteFill}>
                  <Defs>
                    <ClipPath id="clip-tv-main">
                      <SvgRect x="0" y="0" width={60} height={60} rx="16" ry="16" />
                    </ClipPath>
                  </Defs>
                  <SvgPath d={getFavSectorPath(0.7)} fill={colors.primary} fillOpacity={0.9} clipPath="url(#clip-tv-main)" />
                </Svg>
                <MaterialIcons name="tv" size={28} color={colors.onPrimary} />
              </View>
              <Text style={[hp.missionLabel, { color: colors.primary }]}>TV</Text>
            </View>
          </View>
        </View>
      </View>

      {/* 흰색 오버레이 — preview를 dim 처리 (tooltip 강조용 backdrop) */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(255, 255, 255, 0.5)',
        }}
      />

      {/* Play button + tooltip — overlay 위로 올림 (하이라이트 레이어).
          원본 layout 그대로 mirror 후 opacity:0 spacer로 위치 맞춤.
          pointerEvents="box-none" — 확인 버튼 터치 허용, 나머지는 자식이 none 처리. */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <View style={{ width: '100%', flex: 1 }}>
          {/* Header 공간 spacer */}
          <View style={[hp.header, { opacity: 0 }]}>
            <View style={hp.headerLeft}>
              <MaterialIcons name="timer" size={24} color={colors.primary} />
              <Text style={[hp.headerTitle, { color: colors.onBackground }]}>ShutTimer</Text>
            </View>
          </View>
          {/* Dial 공간 spacer (TimerDial 330 + 다이얼 switcher ~44 + margin) */}
          <View style={[hp.dialSection, { opacity: 0 }]}>
            <View style={{ width: 330, height: 330 }} />
            <View style={{ height: 32, marginTop: 12 }} />
          </View>
          {/* Play button 섹션 (링 + tooltip) */}
          <View style={{ alignItems: 'center', justifyContent: 'center', marginBottom: 6, gap: 8 }}>
            <View style={{ opacity: 0, borderWidth: 2, borderColor: 'transparent', borderRadius: 50, paddingHorizontal: 24, paddingVertical: 6 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', letterSpacing: 1 }}>13 : 00</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <View style={{ width: 130 }} />
              <View style={{ width: 80, height: 80, alignItems: 'center', justifyContent: 'center' }}>
                <Svg width={80} height={80} style={{ position: 'absolute' }}>
                  <SvgCircle cx={40} cy={40} r={38} fill="none" stroke={colors.outlineVariant} strokeWidth={3} opacity={0.8} />
                  <SvgCircle
                    cx={40}
                    cy={40}
                    r={38}
                    fill="none"
                    stroke={colors.primary}
                    strokeWidth={3}
                    strokeDasharray={2 * Math.PI * 38}
                    strokeDashoffset={2 * Math.PI * 38 * 0.5}
                    strokeLinecap="round"
                    rotation="-90"
                    origin="40, 40"
                  />
                </Svg>
                <View style={[hp.playButton, { backgroundColor: colors.primary }]}>
                  <MaterialIcons name="pause" size={40} color={colors.onPrimary} />
                </View>
              </View>
              <Animated.Text style={{ width: 130, fontSize: 13, fontWeight: '600', color: colors.onBackground, lineHeight: 18, opacity: playTooltipOp }}>
                {tooltipPlayLabel}
              </Animated.Text>
            </View>
          </View>
          {/* Favorites 섹션 — divider/Add/TV 모두 spacer (메인에서 렌더), TV 우측에 tooltip만 표시 */}
          <View style={{ width: '100%', marginBottom: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, width: '100%', opacity: 0 }}>
              <View style={{ flex: 1, height: 1 }} />
              <Text style={hp.favTitle}>Favorites</Text>
              <View style={{ flex: 1, height: 1 }} />
            </View>
            <View style={[hp.missionList, { alignItems: 'center' }]}>
              {/* Add spacer */}
              <View style={[hp.missionItem, { opacity: 0 }]}>
                <View style={hp.addBtn} />
              </View>
              {/* TV + 텍스트 — 적당한 간격 */}
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 }}>
                <View style={[hp.missionItem, { opacity: 0 }]}>
                  <View style={hp.missionIcon} />
                </View>
                <Animated.Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: colors.onBackground, lineHeight: 18, opacity: favTooltipOp }}>
                  {tooltipFavLabel}
                </Animated.Text>
              </View>
            </View>
          </View>
        </View>
        {/* 확인 버튼 — 화면 정중앙 (absolute, center both axes). 버튼 폭은 텍스트 길이에 맞춰 자동 조정 (minWidth 제거) */}
        <Animated.View
          pointerEvents="box-none"
          style={{
            opacity: confirmOp,
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <TouchableOpacity style={styles.startButton} onPress={onStart}>
            <Text style={styles.startButtonText}>{confirmLabel}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

const hp = StyleSheet.create({
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
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 16,
  },
  dialSection: {
    marginTop: 12,
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missionList: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    gap: 24,
  },
  missionItem: {
    alignItems: 'center',
    gap: 8,
    width: 64,
  },
  addBtn: {
    width: 60,
    height: 60,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    opacity: 0.7,
  },
  missionIcon: {
    width: 60,
    height: 60,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  favTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    marginHorizontal: 12,
  },
  missionLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
});

// feature-cards 슬라이드 — 타이틀 → 카드 1개씩 fade-in (slide up).
function FeatureCardsSlide({
  active,
  title,
  cards,
  colors,
  styles,
  onComplete,
}: {
  active: boolean;
  title: string;
  cards: Card[];
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  onComplete: () => void;
}) {
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const cardOpsRef = useRef<Animated.Value[]>([]);
  const cardYsRef = useRef<Animated.Value[]>([]);
  if (cardOpsRef.current.length !== cards.length) {
    cardOpsRef.current = cards.map(() => new Animated.Value(0));
    cardYsRef.current = cards.map(() => new Animated.Value(20));
  }
  const playedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    if (playedRef.current) {
      titleOpacity.setValue(1);
      cardOpsRef.current.forEach((o) => o.setValue(1));
      cardYsRef.current.forEach((y) => y.setValue(0));
      onComplete();
      return;
    }
    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    titleOpacity.setValue(0);
    cardOpsRef.current.forEach((o) => o.setValue(0));
    cardYsRef.current.forEach((y) => y.setValue(20));

    const animateCard = (idx: number) => {
      if (stopped) return;
      if (idx >= cards.length) {
        onComplete(); // 모든 카드 완료 → 이동 버튼 활성
        return;
      }
      Animated.parallel([
        Animated.timing(cardOpsRef.current[idx], {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(cardYsRef.current[idx], {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished || stopped) return;
        timeoutId = setTimeout(() => animateCard(idx + 1), 350);
      });
    };

    Animated.timing(titleOpacity, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || stopped) return;
      timeoutId = setTimeout(() => animateCard(0), 300);
    });

    return () => {
      stopped = true;
      if (timeoutId) clearTimeout(timeoutId);
      titleOpacity.stopAnimation();
      cardOpsRef.current.forEach((o) => o.stopAnimation());
      cardYsRef.current.forEach((y) => y.stopAnimation());
      playedRef.current = true;
    };
  }, [active, cards.length, titleOpacity, onComplete]);

  return (
    <View style={styles.slide}>
      <Animated.Text style={[styles.title, { opacity: titleOpacity, marginBottom: 32 }]}>
        {title}
      </Animated.Text>
      <View style={{ width: '100%', gap: 12 }}>
        {cards.map((card, i) => (
          <Animated.View
            key={i}
            style={{
              opacity: cardOpsRef.current[i] ?? 0,
              transform: [{ translateY: cardYsRef.current[i] ?? new Animated.Value(0) }],
            }}
          >
            <View style={styles.cardOption}>
              <View style={styles.cardOptionIconWrapper}>
                <MaterialIcons name={card.icon as any} size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.cardOptionLabel}>{card.label}</Text>
                <Text style={styles.cardOptionDescription}>{card.description}</Text>
              </View>
            </View>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    topNav: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 12,
      height: 48,
    },
    topNavBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    topNavText: {
      fontSize: 14,
      color: colors.secondary,
      fontWeight: '600',
    },
    greetingText: {
      fontSize: 39,
      fontWeight: '800',
      color: colors.onBackground,
      letterSpacing: -1,
      textAlign: 'center',
    },
    welcomeText: {
      fontSize: 24,
      fontWeight: '800',
      color: colors.onBackground,
      letterSpacing: -1,
      textAlign: 'center',
      lineHeight: 32,
    },
    slide: {
      width: SCREEN_W,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      paddingBottom: 80,
    },
    iconWrap: {
      width: 160,
      height: 160,
      borderRadius: 80,
      backgroundColor: colors.surfaceContainerLow,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 32,
    },
    title: {
      fontSize: 24,
      fontWeight: '800',
      color: colors.onBackground,
      textAlign: 'center',
      marginBottom: 16,
      letterSpacing: -0.5,
    },
    body: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.secondary,
      textAlign: 'center',
      marginBottom: 32,
      paddingHorizontal: 8,
    },
    permissionButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 32,
      paddingVertical: 14,
      borderRadius: 28,
      marginTop: 8,
      alignItems: 'center',
    },
    permissionButtonText: {
      color: colors.onPrimary,
      fontSize: 16,
      fontWeight: '700',
    },
    startButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 48,
      paddingVertical: 16,
      borderRadius: 32,
      marginTop: 8,
      alignItems: 'center',
    },
    startButtonText: {
      color: colors.onPrimary,
      fontSize: 18,
      fontWeight: '800',
    },
    bottomBar: {
      paddingHorizontal: 24,
      paddingVertical: 20,
      gap: 16,
      alignItems: 'center',
    },
    dots: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    cardOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      paddingVertical: 16,
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainerLow,
    },
    cardOptionIconWrapper: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainerLowest,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardOptionLabel: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.onBackground,
    },
    cardOptionDescription: {
      fontSize: 12,
      color: colors.secondary,
      opacity: 0.8,
    },
    nextButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 24,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    nextButtonText: {
      color: colors.onPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
  });
