import React from 'react';
import { View, Platform } from 'react-native';
import { usePurchase } from '../context/PurchaseContext';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

const PROD_BANNER_UNIT_ID = Platform.OS === 'ios'
  ? 'ca-app-pub-3043284478228309/4187716112'
  : 'ca-app-pub-3043284478228309/6158631734';

const BANNER_UNIT_ID = __DEV__ ? TestIds.ADAPTIVE_BANNER : PROD_BANNER_UNIT_ID;

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
