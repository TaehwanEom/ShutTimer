// YOLO v10 TFLite 모델 측 module-level singleton cache. 첫 load 후 = app process lifetime 측 잔존.
// 직전 = AlarmCameraMode 측 useTensorflowModel hook → 매 mount 시 15MB 모델 새로 load (= 발열 root cause 후보).
// 정정 = singleton + loadingPromise mutex (= race-safe). 두 번째 알람 진입부터 = 0초 영역 ✅.
import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { Platform } from 'react-native';

let cachedModel: TensorflowModel | null = null;
let loadingPromise: Promise<TensorflowModel> | null = null;

export async function getTfliteModel(): Promise<TensorflowModel> {
  if (cachedModel) return cachedModel;
  if (loadingPromise) return loadingPromise;
  loadingPromise = loadTensorflowModel(
    require('../../assets/models/yolov10s_float16.tflite'),
    Platform.OS === 'ios' ? ['core-ml'] : []
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
  return loadingPromise;
}
