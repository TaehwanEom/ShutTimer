import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Notice'>;
};

const NOTICES_URL = 'https://taehwaneom.github.io/shuttimer-config/notices.json';
const NOTICES_READ_KEY = 'shuttimer_notices_read';

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  backBtn: { padding: 8, borderRadius: 50, width: 40 },
  headerTitle: {
    fontSize: 18, fontWeight: '800',
    color: colors.onBackground, letterSpacing: -0.5,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  card: {
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerLow,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 15, fontWeight: '700',
    color: colors.onBackground, flex: 1,
  },
  cardDate: {
    fontSize: 12, color: colors.secondary,
  },
  cardMessage: {
    fontSize: 13, color: colors.secondary, lineHeight: 20,
  },
  empty: {
    fontSize: 14, color: colors.secondary,
    textAlign: 'center', paddingVertical: 60,
  },
});

export default function NoticeScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  const [notices, setNotices] = useState<{ id: string; date: string; title: string; message: string }[]>([]);

  useFocusEffect(
    useCallback(() => {
      fetch(NOTICES_URL)
        .then(r => r.json())
        .then(data => {
          const list = data.notices ?? [];
          setNotices(list);
          const ids = list.map((n: { id: string }) => n.id);
          AsyncStorage.setItem(NOTICES_READ_KEY, JSON.stringify(ids));
        })
        .catch(() => {});
    }, [])
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('notices.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.listContent}>
          {notices.length === 0 ? (
            <Text style={styles.empty}>{t('notices.empty')}</Text>
          ) : (
            notices.map(n => (
              <View key={n.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{n.title}</Text>
                  <Text style={styles.cardDate}>{n.date}</Text>
                </View>
                <Text style={styles.cardMessage}>{n.message}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
