// @v1.5-poc — YOLOv10n Object Detection 스파이크 검증 화면. PASS 후 제거.
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
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import {
  detectObjects,
  loadDetectionModel,
  type Detection,
} from '../utils/objectDetection';
import { Logger } from '../utils/logger';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PoCPhotoValidation'>;
};

export default function PoCPhotoValidationScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [modelReady, setModelReady] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [inferenceMs, setInferenceMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDetectionModel()
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
          Alert.alert('카메라 권한 필요', '검증을 위해 카메라 권한이 필요합니다.', [
            { text: '확인', onPress: () => navigation.goBack() },
          ]);
        }
      });
    }
  }, [permission, requestPermission, navigation]);

  const onCapture = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
      if (!photo?.uri) {
        setError('촬영 실패');
        return;
      }
      const t0 = Date.now();
      const results = await detectObjects(photo.uri);
      setInferenceMs(Date.now() - t0);
      setDetections(results);
      setCameraOpen(false);
    } catch (e: any) {
      Logger.error('PoC', `detect failed: ${e?.message ?? e}`);
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const closeCamera = () => {
    if (busy) return;
    setCameraOpen(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>PoC: YOLOv10 감지</Text>
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
            {modelReady ? '모델 준비 완료 (YOLOv10n)' : '모델 로드 중...'}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, (busy || !modelReady) && styles.btnDisabled]}
          onPress={() => setCameraOpen(true)}
          disabled={busy || !modelReady}
        >
          <MaterialIcons name="photo-camera" size={22} color="#fff" />
          <Text style={styles.primaryBtnText}>촬영하여 감지</Text>
        </TouchableOpacity>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {detections.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>감지 결과 ({detections.length}건)</Text>
            <View style={styles.resultBox}>
              {detections.map((d, i) => (
                <View key={i} style={styles.resultRow}>
                  <Text style={styles.resultLabel}>{d.label}</Text>
                  <Text style={[
                    styles.resultValue,
                    d.confidence >= 0.7 && { color: '#16a34a', fontWeight: '800' },
                    d.confidence >= 0.5 && d.confidence < 0.7 && { color: '#ca8a04' },
                  ]}>
                    {d.confidence.toFixed(3)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {detections.length === 0 && inferenceMs !== null && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>감지 결과</Text>
            <View style={styles.resultBox}>
              <Text style={styles.resultLabel}>감지된 사물 없음</Text>
            </View>
          </View>
        )}

        {inferenceMs !== null && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>성능</Text>
            <View style={styles.resultBox}>
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>추론 시간</Text>
                <Text style={[
                  styles.resultValue,
                  inferenceMs <= 500 ? { color: '#16a34a' } : { color: '#dc2626' },
                ]}>
                  {inferenceMs}ms
                </Text>
              </View>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[styles.secondaryBtn, busy && styles.btnDisabled]}
          onPress={() => { setDetections([]); setInferenceMs(null); setError(null); }}
          disabled={busy}
        >
          <MaterialIcons name="refresh" size={20} color={colors.onBackground} />
          <Text style={styles.secondaryBtnText}>초기화</Text>
        </TouchableOpacity>
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
                <Text style={styles.cameraModeText}>사물을 비추고 촬영</Text>
                <TouchableOpacity
                  style={[styles.shutterBtn, busy && styles.btnDisabled]}
                  onPress={onCapture}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#bc000a" size="large" />
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
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 16,
    },
    backBtn: { padding: 8, borderRadius: 50, width: 40 },
    headerTitle: {
      fontSize: 18, fontWeight: '800', color: colors.onBackground, letterSpacing: -0.5,
    },
    content: { paddingHorizontal: 24, paddingBottom: 48, gap: 24 },
    statusBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12,
    },
    statusOk: { backgroundColor: '#16a34a' },
    statusLoading: { backgroundColor: '#64748b' },
    statusText: { color: '#fff', fontSize: 13, fontWeight: '600' },
    section: { gap: 8 },
    sectionTitle: {
      fontSize: 11, fontWeight: '800', color: colors.secondary, letterSpacing: 1.5,
    },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary,
    },
    primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    secondaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.surfaceContainerLow,
    },
    secondaryBtnText: { color: colors.onBackground, fontSize: 14, fontWeight: '600' },
    btnDisabled: { opacity: 0.4 },
    errorBox: {
      padding: 16, borderRadius: 12, backgroundColor: '#fef2f2',
    },
    errorText: { color: '#dc2626', fontSize: 13 },
    resultBox: {
      padding: 16, borderRadius: 12, backgroundColor: colors.surfaceContainerLow, gap: 10,
    },
    resultRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    },
    resultLabel: {
      fontSize: 15, color: colors.onBackground, fontWeight: '600',
    },
    resultValue: {
      fontSize: 15, color: colors.secondary, fontVariant: ['tabular-nums'],
    },
    cameraContainer: { flex: 1, backgroundColor: '#000' },
    cameraOverlay: { flex: 1, justifyContent: 'space-between' },
    cameraPreviewArea: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    cameraCloseBtn: {
      position: 'absolute', top: 16, left: 16, zIndex: 10,
      width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center', justifyContent: 'center',
    },
    cameraBottom: {
      marginTop: 'auto', alignItems: 'center', gap: 16, paddingBottom: 32,
    },
    cameraModeText: {
      color: '#fff', fontSize: 14, fontWeight: '700',
      backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 16, paddingVertical: 8,
      borderRadius: 20,
    },
    shutterBtn: {
      width: 76, height: 76, borderRadius: 38, backgroundColor: '#fff',
      borderWidth: 4, borderColor: 'rgba(255,255,255,0.5)',
      alignItems: 'center', justifyContent: 'center',
    },
    shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
    permissionDenied: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  });
