import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import Purchases, { CustomerInfo } from 'react-native-purchases';
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

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
  const [isAdFree, setIsAdFree] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkEntitlement = (info: CustomerInfo) => {
    setIsAdFree(info.entitlements.active[ENTITLEMENT_ID] !== undefined);
  };

  useEffect(() => {
    const init = async () => {
      const key = Platform.OS === 'ios' ? REVENUECAT_API_KEY_IOS : REVENUECAT_API_KEY_ANDROID;
      if (!key) {
        setLoading(false);
        return;
      }
      const timeout = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 5000));
      try {
        await Purchases.configure({ apiKey: key });
        const result = await Promise.race([Purchases.getCustomerInfo(), timeout]);
        if (result !== 'timeout') checkEntitlement(result as CustomerInfo);
      } catch {}
      setLoading(false);
    };
    init();
  }, []);

  const purchaseAdFree = async () => {
    try {
      const offerings = await Purchases.getOfferings();
      const pkg = offerings.current?.availablePackages[0];
      if (!pkg) return;
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      checkEntitlement(customerInfo);
    } catch (e: any) {
      if (!e.userCancelled) throw e;
    }
  };

  const restorePurchases = async (): Promise<boolean> => {
    try {
      const info = await Purchases.restorePurchases();
      const active = info.entitlements.active[ENTITLEMENT_ID] !== undefined;
      checkEntitlement(info);
      return active;
    } catch {
      return false;
    }
  };

  return (
    <PurchaseContext.Provider value={{ isAdFree, loading, purchaseAdFree, restorePurchases }}>
      {children}
    </PurchaseContext.Provider>
  );
}
