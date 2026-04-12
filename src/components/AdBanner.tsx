import React from 'react';
import { View, Platform } from 'react-native';
import { usePurchase } from '../context/PurchaseContext';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';

const BANNER_UNIT_ID = Platform.OS === 'ios'
  ? 'ca-app-pub-3043284478228309/4187716112'
  : 'ca-app-pub-3043284478228309/6158631734';

export default function AdBanner() {
  const { isAdFree, loading } = usePurchase();
  if (loading || isAdFree) return null;

  return (
    <View style={{ width: '100%', alignItems: 'center' }}>
      <BannerAd
        unitId={BANNER_UNIT_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdFailedToLoad={(error) => console.warn('Banner ad failed:', error)}
      />
    </View>
  );
}
