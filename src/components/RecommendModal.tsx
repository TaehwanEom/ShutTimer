// 친구 추천 모달. 평가 모달 직후 표시 → "예" 누름 = iOS 공유 시트 (= 카톡 / 메시지 등) 호출.
// 트리거 = storeReview.ts 측 maybeRequestRecommend (= 15일 간격).

import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Share,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { Logger } from '../utils/logger';

// v1.8 #RecommendModal — ShutTimer App Store 정식 URL.
const APP_STORE_URL = 'https://apps.apple.com/us/app/shuttimer/id6761991860';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function RecommendModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  const handleAccept = async () => {
    try {
      const message = t('recommend.shareMessage', {
        defaultValue: 'ShutTimer 로 알람 미션에 도전해 보세요! ',
      });
      await Share.share({
        message: Platform.OS === 'ios' ? message : `${message} ${APP_STORE_URL}`,
        url: Platform.OS === 'ios' ? APP_STORE_URL : undefined,
      });
      Logger.info('Recommend', 'share invoked');
    } catch (e) {
      Logger.warn('Recommend', `share failed: ${String(e)}`);
    } finally {
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>
            {t('recommend.title', { defaultValue: '친구에게 추천하시겠어요?' })}
          </Text>
          <Text style={styles.body}>
            {t('recommend.body', {
              defaultValue: 'ShutTimer 로 알람 미션에 도전해 보는 걸 친구에게 알려 주세요.',
            })}
          </Text>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={onClose}>
              <Text style={[styles.btnText, styles.btnTextSecondary]}>
                {t('recommend.no', { defaultValue: '아니오' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleAccept}>
              <Text style={[styles.btnText, styles.btnTextPrimary]}>
                {t('recommend.yes', { defaultValue: '예' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: colors.surfaceContainerLow,
      borderRadius: 18,
      padding: 24,
      gap: 12,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.onBackground,
      textAlign: 'center',
    },
    body: {
      fontSize: 14,
      color: colors.secondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    row: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 8,
    },
    btn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
    },
    btnPrimary: {
      backgroundColor: colors.primary,
    },
    btnSecondary: {
      backgroundColor: colors.surfaceContainerLowest,
    },
    btnText: {
      fontSize: 15,
      fontWeight: '700',
    },
    btnTextPrimary: {
      color: colors.onPrimary,
    },
    btnTextSecondary: {
      color: colors.onBackground,
    },
  });
