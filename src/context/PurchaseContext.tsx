import React, { createContext, useContext, useState, useEffect } from 'react';
import Constants from 'expo-constants';
import { Logger } from '../utils/logger';

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

export function PurchaseProvider({ children }: { children: React.ReactNode }) {
  const [isAdFree, setIsAdFree] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isExpoGo) {
      Logger.info('PurchaseContext', 'Initializing (Expo Go mode)');
      // Expo Go: 구매 기능 비활성화
      setIsAdFree(false);
      setLoading(false);
      Logger.info('PurchaseContext', 'Initialization complete - Ad-free disabled');
    } else {
      Logger.info('PurchaseContext', 'Initializing (Production mode)');
      // TODO: Purchases.configure() 호출 예정
      setIsAdFree(false);
      setLoading(false);
      Logger.info('PurchaseContext', 'Initialization complete');
    }
  }, []);

  const purchaseAdFree = async () => {
    if (isExpoGo) {
      Logger.warn('PurchaseContext', 'Purchase not available in Expo Go');
    } else {
      Logger.warn('PurchaseContext', 'Purchase not yet implemented in Production');
    }
  };

  const restorePurchases = async (): Promise<boolean> => {
    if (isExpoGo) {
      Logger.warn('PurchaseContext', 'Restore not available in Expo Go');
    } else {
      Logger.warn('PurchaseContext', 'Restore not yet implemented in Production');
    }
    return false;
  };

  return (
    <PurchaseContext.Provider value={{ isAdFree, loading, purchaseAdFree, restorePurchases }}>
      {children}
    </PurchaseContext.Provider>
  );
}
