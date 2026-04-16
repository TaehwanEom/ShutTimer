// @v1.5-poc — Phase A 검증용 임시 화면. Phase A PASS 후 제거.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  ScrollView,
  Modal,
  ActivityIndicator,
  Image,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import {
  extractEmbedding,
  cosineSimilarity,
  loadEmbeddingModel,
  EMBEDDING_THRESHOLD,
} from '../utils/embedding';
import { Logger } from '../utils/logger';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PoCPhotoValidation'>;
};

type Mode = 'register' | 'compare';

const THRESHOLDS = [0.8, 0.85, 0.9];

export default function PoCPhotoValidationScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [modelReady, setModelReady] = useState(false);
  const [registered, setRegistered] = useState<Float32Array[]>([]);
  const [registeredUris, setRegisteredUris] = useState<string[]>([]);
  const [scores, setScores] = useState<number[] | null>(null);
  const [extractMs, setExtractMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('register');
  const [embedDim, setEmbedDim] = useState<number | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);

  useEffect(() => {
    loadEmbeddingModel()
      .then(() => setModelReady(true))
      .catch((e) => {
        Alert.alert('모델 로드 실패', String(e?.message ?? e), [
          { text: '확인', onPress: () => navigation.goBack() },
        ]);
      });
  }, [navigation]);

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted) {
      requestPermission().then((result) => {
        if (!result.granted) {
          Alert.alert(
            '카메라 권한 필요',
            'PoC 검증을 위해 카메라 권한이 필요합니다.',
            [{ text: '확인', onPress: () => navigation.goBack() }]
          );
        }
      });
    }
  }, [permission, requestPermission, navigation]);

  const captureAndExtract = async (): Promise<
    { uri: string; embedding: Float32Array } | null
  > => {
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.8 });
      if (!photo?.uri) return null;
      const t0 = Date.now();
      const embedding = await extractEmbedding(photo.uri);
      setExtractMs(Date.now() - t0);
      setEmbedDim(embedding.length);
      return { uri: photo.uri, embedding };
    } catch (e: any) {
      Logger.error('PoC', `extract failed: ${e?.message ?? e}`);
      Alert.alert('추출 실패', String(e?.message ?? e));
      return null;
    }
  };

  const onRegister = () => {
    if (busy || registered.length >= 3) return;
    if (!modelReady) {
      Alert.alert('모델 로딩 중', '잠시 후 다시 시도해주세요.');
      return;
    }
    setMode('register');
    setCameraOpen(true);
  };

  const onCompare = () => {
    if (busy || registered.length < 3) return;
    if (!modelReady) {
      Alert.alert('모델 로딩 중', '잠시 후 다시 시도해주세요.');
      return;
    }
    setMode('compare');
    setCameraOpen(true);
  };

  const onCapture = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await captureAndExtract();
      if (!result) return;
      if (mode === 'register') {
        if (editIndex !== null) {
          setRegistered((prev) => prev.map((v, i) => i === editIndex ? result.embedding : v));
          setRegisteredUris((prev) => prev.map((v, i) => i === editIndex ? result.uri : v));
          setEditIndex(null);
          setScores(null);
        } else {
          setRegistered((prev) => [...prev, result.embedding]);
          setRegisteredUris((prev) => [...prev, result.uri]);
        }
      } else {
        const query = result.embedding;
        const newScores = registered.map((r) => cosineSimilarity(query, r));
        setScores(newScores);
      }
      setCameraOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const onReset = () => {
    if (busy) return;
    setRegistered([]);
    setRegisteredUris([]);
    setScores(null);
    setExtractMs(null);
  };

  const closeCamera = () => {
    if (busy) return;
    setCameraOpen(false);
    setEditIndex(null);
  };

  const onSlotPress = (index: number) => {
    if (!registeredUris[index]) return;
    if (busy || !modelReady) return;
    setEditIndex(index);
    setMode('register');
    setCameraOpen(true);
  };

  const maxScore = scores ? Math.max(...scores) : null;
  const meanScore = scores ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const nextSlot = registered.length + 1;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>PoC: 사진 인식</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View
          style={[
            styles.statusBanner,
            modelReady ? styles.statusOk : styles.statusLoading,
          ]}
        >
          <MaterialIcons
            name={modelReady ? 'check-circle' : 'hourglass-empty'}
            size={20}
            color="#fff"
          />
          <Text style={styles.statusText}>
            {modelReady ? '모델 준비 완료 (MobileNetV3)' : '모델 로드 중...'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>등록 ({registered.length}/3)</Text>
          <View style={styles.slotRow}>
            {[0, 1, 2].map((i) => (
              <TouchableOpacity
                key={i}
                style={styles.slot}
                onPress={() => onSlotPress(i)}
                disabled={!registeredUris[i] || busy}
                activeOpacity={0.7}
              >
                {registeredUris[i] ? (
                  <View style={styles.slotFilled}>
                    <Image
                      source={{ uri: registeredUris[i] }}
                      style={styles.slotImage}
                    />
                    <View style={styles.slotEditBadge}>
                      <MaterialIcons name="edit" size={12} color="#fff" />
                    </View>
                  </View>
                ) : (
                  <View style={styles.slotEmpty}>
                    <Text style={[styles.slotNum, { color: colors.secondary }]}>
                      {i + 1}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              (busy || registered.length >= 3 || !modelReady) && styles.btnDisabled,
            ]}
            onPress={onRegister}
            disabled={busy || registered.length >= 3 || !modelReady}
          >
            <MaterialIcons name="photo-camera" size={22} color={colors.onPrimary} />
            <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>
              {registered.length >= 3 ? '등록 완료' : `${nextSlot}번 등록`}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryBtn, busy && styles.btnDisabled]}
            onPress={onReset}
            disabled={busy}
          >
            <MaterialIcons name="refresh" size={20} color={colors.onBackground} />
            <Text style={styles.secondaryBtnText}>전체 초기화</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>비교</Text>
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              (busy || registered.length < 3 || !modelReady) && styles.btnDisabled,
            ]}
            onPress={onCompare}
            disabled={busy || registered.length < 3 || !modelReady}
          >
            <MaterialIcons name="search" size={22} color={colors.onPrimary} />
            <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>
              새 사진 비교
            </Text>
          </TouchableOpacity>
          {registered.length < 3 && (
            <Text style={styles.hint}>3장 등록 후 비교 가능</Text>
          )}
        </View>

        {scores && maxScore !== null && meanScore !== null && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>결과</Text>
            <View style={styles.resultBox}>
              {scores.map((s, i) => (
                <View key={i} style={styles.resultRow}>
                  <Text style={styles.resultLabel}>photo_{i + 1}</Text>
                  <Text style={styles.resultValue}>{s.toFixed(4)}</Text>
                </View>
              ))}

              <View style={styles.divider} />

              <View style={styles.resultRow}>
                <Text style={styles.resultLabelBold}>MAX</Text>
                <Text style={styles.resultValueBold}>{maxScore.toFixed(4)}</Text>
              </View>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabelBold}>MEAN</Text>
                <Text style={styles.resultValueBold}>{meanScore.toFixed(4)}</Text>
              </View>

              <View style={styles.divider} />

              {THRESHOLDS.map((th) => (
                <View key={th} style={styles.resultRow}>
                  <Text style={styles.resultLabel}>@ {th.toFixed(2)}</Text>
                  <Text style={styles.resultValue}>
                    MAX {maxScore >= th ? '✅' : '❌'}   MEAN {meanScore >= th ? '✅' : '❌'}
                  </Text>
                </View>
              ))}

              <View style={styles.divider} />

              {extractMs !== null && (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>추출 시간</Text>
                  <Text style={styles.resultValue}>{extractMs}ms</Text>
                </View>
              )}
              {embedDim !== null && (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>dim</Text>
                  <Text style={styles.resultValue}>{embedDim}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        <Text style={styles.footnote}>
          기본 임계치 {EMBEDDING_THRESHOLD} · 메모리 저장 (재시작 시 소실)
        </Text>
      </ScrollView>

      <Modal visible={cameraOpen} animationType="slide" onRequestClose={closeCamera}>
        <View style={styles.cameraContainer}>
          {permission?.granted ? (
            <SafeAreaView style={styles.cameraOverlay}>
              <TouchableOpacity
                style={styles.cameraCloseBtn}
                onPress={closeCamera}
                disabled={busy}
              >
                <MaterialIcons name="close" size={28} color="#fff" />
              </TouchableOpacity>

              <View style={styles.cameraPreviewArea}>
                <CameraView
                  ref={cameraRef}
                  style={{ width: '100%', aspectRatio: 4 / 3 }}
                  facing="back"
                />
              </View>

              <View style={styles.cameraBottom}>
                <Text style={styles.cameraModeText}>
                  {mode === 'compare'
                    ? '비교용 촬영'
                    : editIndex !== null
                      ? `${editIndex + 1}번 재촬영`
                      : `${nextSlot}번 등록`}
                </Text>
                <TouchableOpacity
                  style={[styles.shutterBtn, busy && styles.btnDisabled]}
                  onPress={onCapture}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.primary} size="large" />
                  ) : (
                    <View style={styles.shutterInner} />
                  )}
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          ) : (
            <View style={styles.permissionDenied}>
              <Text style={{ color: '#fff' }}>카메라 권한이 필요합니다.</Text>
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
      fontSize: 18,
      fontWeight: '800',
      color: colors.onBackground,
      letterSpacing: -0.5,
    },
    content: { paddingHorizontal: 24, paddingBottom: 48, gap: 24 },
    statusBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 12,
    },
    statusOk: { backgroundColor: '#16a34a' },
    statusLoading: { backgroundColor: '#64748b' },
    statusText: { color: '#fff', fontSize: 13, fontWeight: '600' },
    section: { gap: 12 },
    sectionTitle: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.secondary,
      letterSpacing: 1.5,
    },
    slotRow: { flexDirection: 'row', gap: 12 },
    slot: { flex: 1, aspectRatio: 1 },
    slotFilled: {
      flex: 1,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainerLow,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    slotEmpty: {
      flex: 1,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainerLow,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.outlineVariant,
      borderStyle: 'dashed',
    },
    slotImage: {
      width: '100%',
      height: '100%',
      borderRadius: 12,
    },
    slotEditBadge: {
      position: 'absolute',
      bottom: 4,
      right: 4,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    slotNum: { fontSize: 22, fontWeight: '800', color: colors.onBackground },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: colors.primary,
    },
    primaryBtnText: { fontSize: 15, fontWeight: '700' },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainerLow,
    },
    secondaryBtnText: { color: colors.onBackground, fontSize: 14, fontWeight: '600' },
    btnDisabled: { opacity: 0.4 },
    hint: { fontSize: 12, color: colors.secondary, textAlign: 'center' },
    resultBox: {
      padding: 16,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainerLow,
      gap: 8,
    },
    resultRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    resultLabel: {
      fontSize: 13,
      color: colors.secondary,
      fontVariant: ['tabular-nums'],
    },
    resultLabelBold: { fontSize: 14, fontWeight: '800', color: colors.onBackground },
    resultValue: {
      fontSize: 13,
      color: colors.onBackground,
      fontVariant: ['tabular-nums'],
    },
    resultValueBold: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.primary,
      fontVariant: ['tabular-nums'],
    },
    divider: {
      height: 1,
      backgroundColor: colors.outlineVariant,
      marginVertical: 4,
      opacity: 0.5,
    },
    footnote: {
      fontSize: 11,
      color: colors.secondary,
      textAlign: 'center',
      opacity: 0.6,
    },
    cameraContainer: { flex: 1, backgroundColor: '#000' },
    cameraOverlay: { flex: 1, justifyContent: 'space-between' },
    cameraPreviewArea: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    cameraCloseBtn: {
      position: 'absolute',
      top: 16,
      left: 16,
      zIndex: 10,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cameraBottom: {
      marginTop: 'auto',
      alignItems: 'center',
      gap: 16,
      paddingBottom: 32,
    },
    cameraModeText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '700',
      backgroundColor: 'rgba(0,0,0,0.5)',
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
    },
    shutterBtn: {
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: '#fff',
      borderWidth: 4,
      borderColor: 'rgba(255,255,255,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
    permissionDenied: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
