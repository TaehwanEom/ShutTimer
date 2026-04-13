import React from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { usePurchase } from '../context/PurchaseContext';
// import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

const isExpoGo = (Constants as any).appOwnership === 'expo';

// PROD IDs kept for restoration after verification build
// iOS: ca-app-pub-3043284478228309/4187716112
// Android: ca-app-pub-3043284478228309/6158631734

export default function AdBanner() {
  const { isAdFree, loading } = usePurchase();
  if (loading || isAdFree || isExpoGo) return null;

  try {
    const { BannerAd, BannerAdSize, TestIds } = require('react-native-google-mobile-ads');
    const BANNER_UNIT_ID = TestIds.ADAPTIVE_BANNER;

    return (
      <View style={{ width: '100%', alignItems: 'center' }}>
        <BannerAd
          unitId={BANNER_UNIT_ID}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          requestOptions={{ requestNonPersonalizedAdsOnly: true }}
          onAdFailedToLoad={(error: any) => console.warn('Banner ad failed:', error?.code, error?.message, error)}
        />
      </View>
    );
  } catch (e) {
    console.warn('BannerAd failed to load:', e);
    return null;
  }
}
