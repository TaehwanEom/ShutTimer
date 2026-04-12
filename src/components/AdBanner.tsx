import React from 'react';
import { View } from 'react-native';
import { usePurchase } from '../context/PurchaseContext';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

// PROD IDs kept for restoration after verification build
// iOS: ca-app-pub-3043284478228309/4187716112
// Android: ca-app-pub-3043284478228309/6158631734
const BANNER_UNIT_ID = TestIds.ADAPTIVE_BANNER;

export default function AdBanner() {
  const { isAdFree, loading } = usePurchase();
  if (loading || isAdFree) return null;

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
}
