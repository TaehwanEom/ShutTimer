import React from 'react';
import { View } from 'react-native';
import { usePurchase } from '../context/PurchaseContext';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';

const BANNER_UNIT_ID = 'ca-app-pub-3940256099942544/9214589741';

export default function AdBanner() {
  const { isAdFree, loading } = usePurchase();
  if (loading || isAdFree) return null;

  return (
    <View style={{ width: '100%', alignItems: 'center' }}>
      <BannerAd
        unitId={BANNER_UNIT_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
      />
    </View>
  );
}
