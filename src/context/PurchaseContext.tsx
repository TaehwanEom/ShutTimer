/**
 * ═══════════════════════════════════════════════════════════
 *  @preserve IAP (PurchaseContext 전체 파일) — Phase 2+ 재활성화용
 *  보존 결정일: 2026-04-14
 *  비활성화 사유: 사업자등록 전까지 IAP 보류 (B안)
 *  현재 상태: 파일 전체 보존. App.tsx에서 Provider 래퍼가 주석 처리되어
 *            이 파일은 import되지 않음. 코드 변경 금지.
 *  재활성화 조건: 사업자등록 + ASC Paid Apps Agreement 활성화
 *  복원 절차: App.tsx의 `@preserve IAP (PurchaseProvider 래퍼)` 블록
 *            해제 + AdBanner/AlarmScreen/SettingsScreen의 @preserve 블록 해제
 *  ⚠️ 이 파일 내부 코드 삭제/수정 금지. 보존 전용.
 * ═══════════════════════════════════════════════════════════
 */
import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { Logger } from '../utils/logger';
import { REVENUECAT_API_KEY_IOS, REVENUECAT_API_KEY_ANDROID, ENTITLEMENT_ID } from '../constants/purchase';

type PurchaseContextType = {
  isAdFree: boolean;
  loading: boolean;
  purchaseAdFree: () => Promise<void>;
  restorePurchases: () => Promise<boolean>;
};

const PurchaseContext = createContext<PurchaseContextType>({
  isAdFree: false,
  loading: true,
  purchaseAdFree: async () => {},
  restorePurchases: async () => false,
});

export const usePurchase = () => useContext(PurchaseContext);

const isExpoGo = (Constants as any).appOwnership === 'expo';

let Purchases: any = null;
if (!isExpoGo) {
  try {
    Purchases = require('react-native-purchases').default;
  } catch (e) {
    Logger.warn('PurchaseContext', `Failed to require react-native-purchases: ${e}`);
  }
}

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
  const [isAdFree, setIsAdFree] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkEntitlement = (info: any) => {
    setIsAdFree(info?.entitlements?.active?.[ENTITLEMENT_ID] !== undefined);
  };

  useEffect(() => {
    if (isExpoGo) {
      Logger.info('PurchaseContext', 'Initializing (Expo Go mode)');
      setIsAdFree(false);
      setLoading(false);
      Logger.info('PurchaseContext', 'Initialization complete - Ad-free disabled');
      return;
    }

    if (!Purchases) {
      Logger.warn('PurchaseContext', 'Purchases SDK not loaded; skipping init');
      setLoading(false);
      return;
    }

    const init = async () => {
      Logger.info('PurchaseContext', 'Initializing (Production mode)');
      const key = Platform.OS === 'ios' ? REVENUECAT_API_KEY_IOS : REVENUECAT_API_KEY_ANDROID;
      if (!key) {
        Logger.info('PurchaseContext', `No API key for platform ${Platform.OS}; skipping configure`);
        setLoading(false);
        return;
      }
      try {
        await Purchases.configure({ apiKey: key });
        const info = await Purchases.getCustomerInfo();
        checkEntitlement(info);
        Logger.info('PurchaseContext', 'Initialization complete');
      } catch (e) {
        Logger.warn('PurchaseContext', `Init failed: ${e}`);
      }
      setLoading(false);
    };
    init();
  }, []);

  const purchaseAdFree = async () => {
    if (isExpoGo || !Purchases) {
      Logger.warn('PurchaseContext', 'Purchase not available in this environment');
      return;
    }
    try {
      const offerings = await Purchases.getOfferings();
      const pkg = offerings.current?.availablePackages?.[0];
      if (!pkg) {
        Logger.warn('PurchaseContext', 'No available package found');
        return;
      }
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      checkEntitlement(customerInfo);
    } catch (e: any) {
      if (e?.userCancelled) return;
      Logger.warn('PurchaseContext', `Purchase failed: ${e}`);
      throw e;
    }
  };

  const restorePurchases = async (): Promise<boolean> => {
    if (isExpoGo || !Purchases) {
      Logger.warn('PurchaseContext', 'Restore not available in this environment');
      return false;
    }
    try {
      const info = await Purchases.restorePurchases();
      const active = info?.entitlements?.active?.[ENTITLEMENT_ID] !== undefined;
      checkEntitlement(info);
      return active;
    } catch (e) {
      Logger.warn('PurchaseContext', `Restore failed: ${e}`);
      return false;
    }
  };

  return (
    <PurchaseContext.Provider value={{ isAdFree, loading, purchaseAdFree, restorePurchases }}>
      {children}
    </PurchaseContext.Provider>
  );
}
