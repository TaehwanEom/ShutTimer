import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';

// AdMob — EAS Development Build 필요, Expo Go 불가
// import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

export default function AdBanner() {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { borderColor: colors.outlineVariant }]}>
      <Text style={[styles.label, { color: colors.secondary }]}>AD</Text>
      {/* <BannerAd
        unitId={TestIds.ADAPTIVE_BANNER}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
      /> */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 60,
    borderTopWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    opacity: 0.4,
  },
});
