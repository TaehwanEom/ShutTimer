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
