// YOLO v10 TFLite 모델 module-level singleton cache. 첫 load 후 app process lifetime 동안 잔존.
//
// 핵심 fix (= Android release 빌드 측 MalformedURLException 우회):
//   react-native-fast-tflite 의 useTensorflowModel / loadTensorflowModel(require(...)) 측 내부에서
//   Image.resolveAssetSource 호출 → release 빌드에서 .tflite 같은 비이미지 asset 측 raw assetId만 반환
//   → native HybridAssetLoader 의 new URL(...) 에서 protocol 없음 → MalformedURLException → 모델 영원히 null.
//   (debug 빌드 측 = Metro http URL 반환 → 정상. release 빌드 측만 회귀)
//
//   정정 = expo-asset 의 Asset.fromModule(...).downloadAsync() 사용 → localUri 반환 →
//          loadTensorflowModel({ url: 'file:///...' }) 형식으로 직접 전달 → native 측 정상 처리.
//
// 플랫폼 분기:
//   Android = expo-asset 우회 사용
//   iOS = 직전 정상 동작 코드 그대로 보존 (= require + core-ml delegate)
import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { Platform } from 'react-native';
import { Asset } from 'expo-asset';

let cachedModel: TensorflowModel | null = null;
let loadingPromise: Promise<TensorflowModel> | null = null;

export async function getTfliteModel(): Promise<TensorflowModel> {
  if (cachedModel) return cachedModel;
  if (loadingPromise) return loadingPromise;

  if (Platform.OS === 'android') {
    loadingPromise = (async () => {
      const asset = Asset.fromModule(require('../../assets/models/yolov10s_float16.tflite'));
      await asset.downloadAsync();
      const localUri = asset.localUri ?? asset.uri;
      // delegates 빈 array 필수 — undefined 시 native createModel 측 "Value is undefined, expected an Object" 에러.
      const model = await loadTensorflowModel({ url: localUri }, []);
      cachedModel = model;
      loadingPromise = null;
      return model;
    })().catch((e) => {
      loadingPromise = null;
      throw e;
    });
  } else {
    loadingPromise = loadTensorflowModel(
      require('../../assets/models/yolov10s_float16.tflite'),
      ['core-ml']
    )
      .then((m) => {
        cachedModel = m;
        loadingPromise = null;
        return m;
      })
      .catch((e) => {
        loadingPromise = null;
        throw e;
      });
  }

  return loadingPromise;
}
