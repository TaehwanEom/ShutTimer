import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Switch,
  TextInput,
  Keyboard,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as ScreenOrientation from 'expo-screen-orientation';
import { RootStackParamList } from '../../App';
import { ThemeColors } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import AdBanner from '../components/AdBanner';
import { useTranslation } from 'react-i18next';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Presentation'>;
};

type Record = {
  id: string;
  date: string;
  duration: number;
  filePath: string;
  title?: string;
  transcript?: string;
};

const RECORDS_KEY = 'shutimer_presentation_records';

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const NEON = '#39FF14';
const NEON_DIM = 'rgba(57,255,20,0.4)';
const SURFACE = '#1a1a1a';

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  backBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignSelf: 'flex-start',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 32,
  },
  modeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  modeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: SURFACE,
    minWidth: 72,
    alignItems: 'center',
  },
  modeBtnActive: {
    backgroundColor: NEON,
  },
  modeBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: NEON_DIM,
  },
  modeBtnTextActive: {
    color: '#000000',
  },
  timeDisplay: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 24,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeInputGroup: {
    alignItems: 'center',
    gap: 6,
  },
  timeInputBox: {
    width: 130,
    height: 117,
    borderRadius: 18,
    backgroundColor: '#000000',
    fontSize: 65,
    fontWeight: '800',
    color: NEON,
    textAlign: 'center',
  },
  timeInputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: NEON_DIM,
  },
  timeSeparator: {
    fontSize: 65,
    fontWeight: '800',
    color: NEON,
    marginHorizontal: 8,
    marginBottom: 20,
  },
  startButton: {
    width: '100%',
    maxWidth: 400,
    paddingVertical: 20,
    borderRadius: 12,
    backgroundColor: NEON,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  startButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#000000',
    letterSpacing: 2,
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: SURFACE,
    marginBottom: 16,
    width: '100%',
  },
  recordingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recordingLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#999999',
  },
  recordsTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: NEON_DIM,
    letterSpacing: 1.5,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  recordItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: SURFACE,
    marginBottom: 6,
    width: '100%',
  },
  recordInfo: {
    flex: 1,
  },
  recordDate: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999999',
  },
  recordDuration: {
    fontSize: 11,
    color: NEON_DIM,
    marginTop: 2,
  },
  recordActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  noRecords: {
    fontSize: 13,
    color: NEON_DIM,
    textAlign: 'center',
    paddingVertical: 24,
    opacity: 0.6,
  },
});

export default function PresentationScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  const [selectedMinutes, setSelectedMinutes] = useState(5);
  const [selectedSeconds, setSelectedSeconds] = useState(0);
  const [minutesText, setMinutesText] = useState('00');
  const [secondsText, setSecondsText] = useState('00');
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [records, setRecords] = useState<Record[]>([]);
  const [playingSound, setPlayingSound] = useState<Audio.Sound | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playingRemainingSec, setPlayingRemainingSec] = useState<number | null>(null);
  const [isPausedId, setIsPausedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const minutesInputRef = useRef<TextInput>(null);
  const secondsInputRef = useRef<TextInput>(null);

  // 세로 잠금 + 복귀 시 시간 리셋 + 키보드 닫기
  useFocusEffect(
    useCallback(() => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      setMinutesText('00');
      setSecondsText('00');
      Keyboard.dismiss();
    }, [])
  );

  // 기록 로드
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(RECORDS_KEY).then(val => {
        if (val) {
          const list: Record[] = JSON.parse(val);
          setRecords(list);
          setExpandedIds(new Set(list.filter(r => r.transcript).map(r => r.id)));
        }
      });
    }, [])
  );

  const handleStart = () => {
    Keyboard.dismiss();
    const m = Math.min(60, Math.max(0, parseInt(minutesText, 10) || 0));
    const s = Math.min(59, Math.max(0, parseInt(secondsText, 10) || 0));
    if (m === 0 && s === 0) return;
    setSelectedMinutes(m);
    setSelectedSeconds(s);
    setMinutesText(String(m).padStart(2, '0'));
    setSecondsText(String(s).padStart(2, '0'));
    navigation.navigate('PresentationRunning', { minutes: m, seconds: s, recordingEnabled });
  };

  const playRecord = async (record: Record) => {
    // 같은 항목 탭 → 일시정지 / 재개
    if (playingId === record.id && playingSound) {
      if (isPausedId === record.id) {
        await playingSound.playAsync();
        setIsPausedId(null);
      } else {
        await playingSound.pauseAsync();
        setIsPausedId(record.id);
      }
      return;
    }
    // 다른 항목 탭 → 기존 정지
    if (playingSound) {
      await playingSound.unloadAsync();
      setPlayingSound(null);
      setPlayingId(null);
      setPlayingRemainingSec(null);
      setIsPausedId(null);
    }
    try {
      const { sound } = await Audio.Sound.createAsync({ uri: record.filePath });
      setPlayingSound(sound);
      setPlayingId(record.id);
      setIsPausedId(null);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          sound.unloadAsync();
          setPlayingSound(null);
          setPlayingId(null);
          setPlayingRemainingSec(null);
          setIsPausedId(null);
        } else {
          const remaining = Math.max(0, record.duration - Math.floor(status.positionMillis / 1000));
          setPlayingRemainingSec(remaining);
        }
      });
      await sound.playAsync();
    } catch {}
  };

  const saveTitle = async (id: string, title: string) => {
    const updated = records.map(r => r.id === id ? { ...r, title: title.trim() || undefined } : r);
    setRecords(updated);
    await AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(updated));
    setEditingId(null);
  };

  const deleteRecord = async (record: Record) => {
    try {
      await FileSystem.deleteAsync(record.filePath, { idempotent: true });
    } catch {}
    const updated = records.filter(r => r.id !== record.id);
    setRecords(updated);
    await AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(updated));
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={{ flex: 1 }}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back-ios" size={20} color={NEON} />
        </TouchableOpacity>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Mode Toggle */}
          <View style={styles.modeRow}>
            <TouchableOpacity style={styles.modeBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.modeBtnText}>{t('presentation.timer')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeBtn, styles.modeBtnActive]}>
              <Text style={[styles.modeBtnText, styles.modeBtnTextActive]}>{t('presentation.title')}</Text>
            </TouchableOpacity>
          </View>

          {/* Time Display = 분:초 설정 */}
          <View style={styles.timeDisplay}>
            <View style={styles.timeRow}>
              <View style={styles.timeInputGroup}>
                <TextInput
                  ref={minutesInputRef}
                  style={styles.timeInputBox}
                  value={minutesText}
                  keyboardType="number-pad"
                  maxLength={2}
                  onFocus={() => { if (minutesText === '00') setMinutesText(''); }}
                  onChangeText={setMinutesText}
                  onBlur={() => {
                    const n = parseInt(minutesText, 10);
                    if (isNaN(n)) { setMinutesText('00'); return; }
                    const clamped = Math.min(60, Math.max(0, n));
                    setSelectedMinutes(clamped);
                    setMinutesText(String(clamped).padStart(2, '0'));
                  }}
                />
                <Text style={styles.timeInputLabel}>{t('presentation.minutes')}</Text>
              </View>
              <Text style={styles.timeSeparator}>:</Text>
              <View style={styles.timeInputGroup}>
                <TextInput
                  ref={secondsInputRef}
                  style={styles.timeInputBox}
                  value={secondsText}
                  keyboardType="number-pad"
                  maxLength={2}
                  onFocus={() => { if (secondsText === '00') setSecondsText(''); }}
                  onChangeText={setSecondsText}
                  onBlur={() => {
                    const n = parseInt(secondsText, 10);
                    if (isNaN(n)) { setSecondsText('00'); return; }
                    const clamped = Math.min(59, Math.max(0, n));
                    setSelectedSeconds(clamped);
                    setSecondsText(String(clamped).padStart(2, '0'));
                  }}
                />
                <Text style={styles.timeInputLabel}>{t('presentation.seconds')}</Text>
              </View>
            </View>
          </View>

          {/* Start Button */}
          <TouchableOpacity style={styles.startButton} onPress={handleStart} activeOpacity={0.85}>
            <Text style={styles.startButtonText}>{t('home.start')}</Text>
          </TouchableOpacity>

          {/* Recording Toggle */}
          <View style={styles.recordingRow}>
            <View style={styles.recordingLeft}>
              <MaterialIcons name="mic" size={22} color={NEON} />
              <Text style={styles.recordingLabel}>{t('presentation.recording')}</Text>
            </View>
            <Switch
              value={recordingEnabled}
              onValueChange={setRecordingEnabled}
              trackColor={{ false: '#333333', true: NEON }}
              thumbColor="#ffffff"
              style={{ transform: [{ scale: 0.85 }] }}
            />
          </View>

          {/* Records */}
          <Text style={styles.recordsTitle}>{t('presentation.records')}</Text>
          {records.length === 0 ? (
            <Text style={styles.noRecords}>{t('presentation.noRecords')}</Text>
          ) : (
            records.map((record) => (
              <View key={record.id} style={[styles.recordItem, { flexDirection: 'column', alignItems: 'stretch' }]}>
                <TouchableOpacity
                  activeOpacity={record.transcript ? 0.7 : 1}
                  onPress={() => {
                    if (!record.transcript) return;
                    setExpandedIds(prev => {
                      const next = new Set(prev);
                      next.has(record.id) ? next.delete(record.id) : next.add(record.id);
                      return next;
                    });
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center' }}
                >
                <View style={{ flex: 1 }}>
                  {editingId === record.id ? (
                    <TextInput
                      style={[styles.recordDate, { borderBottomWidth: 1, borderBottomColor: NEON, paddingVertical: 2 }]}
                      value={editingTitle}
                      onChangeText={setEditingTitle}
                      onBlur={() => saveTitle(record.id, editingTitle)}
                      onSubmitEditing={() => saveTitle(record.id, editingTitle)}
                      autoFocus
                      returnKeyType="done"
                      maxLength={40}
                    />
                  ) : (
                    <TouchableOpacity onPress={() => { setEditingId(record.id); setEditingTitle(record.title ?? ''); }}>
                      <Text style={[styles.recordDate, record.title ? { color: '#ffffff' } : {}]}>
                        {record.title ?? `${new Date(record.date).toLocaleDateString('ko-KR')} ${new Date(record.date).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {!record.title && editingId !== record.id && (
                    <Text style={{ fontSize: 10, color: NEON_DIM, marginTop: 2, opacity: 0.5 }}>탭하여 이름 추가</Text>
                  )}
                </View>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={styles.recordDuration}>
                    {playingId === record.id && playingRemainingSec !== null
                      ? formatDuration(playingRemainingSec)
                      : formatDuration(record.duration)}
                  </Text>
                </View>
                  <View style={[styles.recordActions, { flex: 1, justifyContent: 'flex-end' }]}>
                    <TouchableOpacity onPress={() => playRecord(record)}>
                      <MaterialIcons
                        name={playingId === record.id && isPausedId !== record.id ? 'pause' : 'play-arrow'}
                        size={24}
                        color={NEON}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteRecord(record)}>
                      <MaterialIcons name="delete-outline" size={22} color="#666666" />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
                {record.transcript && expandedIds.has(record.id) && (
                  <Text style={{ fontSize: 13, color: '#cccccc', marginTop: 10, lineHeight: 20 }}>
                    {record.transcript}
                  </Text>
                )}
              </View>
            ))
          )}
          <View style={{ height: 24 }} />
        </ScrollView>

        <AdBanner />
      </SafeAreaView>
    </View>
  );
}
