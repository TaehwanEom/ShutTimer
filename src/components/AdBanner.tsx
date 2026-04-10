import React from 'react';
import { View, Text } from 'react-native';
import { usePurchase } from '../context/PurchaseContext';
// import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';

// const BANNER_UNIT_ID = 'ca-app-pub-3940256099942544/9214589741';

export default function AdBanner() {
  const { isAdFree, loading } = usePurchase();
  if (loading || isAdFree) return null;

  return (
    <View style={{ width: '100%', height: 60, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 2, opacity: 0.4 }}>AD</Text>
    </View>
  );
}
