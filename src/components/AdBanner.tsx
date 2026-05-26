import React, { useState, useEffect } from 'react';
import { View, Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Logger } from '../utils/logger';
// @preserve IAP — Phase 2+ 복원용. 삭제 금지. (TS6133 회피 위해 import 라인 주석)
// import { usePurchase } from '../context/PurchaseContext';
// import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

const isExpoGo = (Constants as any).appOwnership === 'expo';
// v1.8 #AdHideGate — Debug 빌드 (= Xcode 직접 / expo run:ios / EAS dev|preview) 측 = 광고 호출 차단.
// Release 빌드 (= EAS production / Xcode Archive) 측 = EXPO_PUBLIC_HIDE_ADS=false → 광고 정상 표시.
// __DEV__ = React Native 빌드 configuration 자동 분기 (= Debug=true / Release=false).
const HIDE_ADS = __DEV__ || process.env.EXPO_PUBLIC_HIDE_ADS === 'true';

// PROD IDs kept for restoration after verification build
// iOS: ca-app-pub-3043284478228309/4187716112
// Android: ca-app-pub-3043284478228309/6158631734

// v1.9 #RequireOnce — 직전 = render마다 require() 호출 → 모듈 캐시 측 = 매번 lookup + try/catch 측 = 성능 부담.
// 정정 = 모듈 로드 시점 측 1회성 require + module-scope 변수 측 cache → render 측 = lookup X.
let BannerAdModule: any = null;
let bannerRequireError: string | null = null;
if (!isExpoGo && !HIDE_ADS) {
  try {
    BannerAdModule = require('react-native-google-mobile-ads');
  } catch (e: any) {
    bannerRequireError = e?.message || String(e);
  }
}

const BANNER_UNIT_ID = Platform.select({
  ios: 'ca-app-pub-3043284478228309/4187716112',
  android: 'ca-app-pub-3043284478228309/6158631734',
}) as string;

export default function AdBanner() {
  // @preserve IAP — usePurchase 훅 호출. Phase 2+ 복원용. 삭제 금지.
  // const { isAdFree, loading } = usePurchase();
  const [npa, setNpa] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem('attStatus').then(status => {
      if (status === 'granted') setNpa(false);
    }).catch(() => {});
  }, []);

  /**
   * ═══════════════════════════════════════════════════════════
   *  @preserve IAP (isAdFree 배너 차단 분기) — Phase 2+ 재활성화용
   *  보존 결정일: 2026-04-14
   *  비활성화 사유: IAP 보류 (B안). 모든 사용자에게 배너 항상 노출.
   *  재활성화 조건: 사업자등록 + ASC Paid Apps Agreement 활성화
   *  ⚠️ 이 블록 삭제 금지. 주석 해제만으로 복원 가능해야 함.
   *
   *  @preserve-original:
   *  if (loading || isAdFree || isExpoGo) return null;
   * ═══════════════════════════════════════════════════════════
   */
  if (isExpoGo || HIDE_ADS) return null;
  if (!BannerAdModule) {
    if (bannerRequireError) Logger.warn('AdMob', `BannerAd require failed: ${bannerRequireError}`);
    return null;
  }

  const { BannerAd, BannerAdSize } = BannerAdModule;
  return (
    <View style={{ width: '100%', alignItems: 'center' }}>
      <BannerAd
        unitId={BANNER_UNIT_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: npa }}
        onAdFailedToLoad={(error: any) => {
          Logger.warn('AdMob', `Banner failed: code=${error?.code} domain=${error?.domain} msg=${error?.message}`);
        }}
        onAdLoaded={() => {
          Logger.info('AdMob', 'Banner loaded');
        }}
      />
    </View>
  );
}
