import { loadTensorflowModel } from 'react-native-fast-tflite';
import type { TfliteModel } from 'react-native-fast-tflite/lib/typescript/specs/Tflite.nitro';
import * as ImageManipulator from 'expo-image-manipulator';
import jpeg from 'jpeg-js';

const INPUT_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.5;
const MAX_DETECTIONS = 300;

let model: TfliteModel | null = null;
let loadPromise: Promise<TfliteModel> | null = null;

export async function loadDetectionModel(): Promise<TfliteModel> {
  if (model) return model;
  if (!loadPromise) {
    loadPromise = loadTensorflowModel(
      require('../../assets/models/yolov10n_float16.tflite'),
      []
    );
  }
  model = await loadPromise;
  return model;
}

export type Detection = {
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
};

// COCO 80 classes
const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
  'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
  'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
  'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
  'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
  'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
  'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
  'hair drier', 'toothbrush',
];

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = global.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function imageUriToFloat32(imageUri: string): Promise<Float32Array> {
  const manipulated = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: INPUT_SIZE, height: INPUT_SIZE } }],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );

  if (!manipulated.base64) {
    throw new Error('Failed to encode image to base64');
  }

  const jpegBytes = base64ToUint8Array(manipulated.base64);
  const decoded = jpeg.decode(jpegBytes, { useTArray: true });

  const float32 = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    float32[i * 3] = decoded.data[i * 4] / 255;
    float32[i * 3 + 1] = decoded.data[i * 4 + 1] / 255;
    float32[i * 3 + 2] = decoded.data[i * 4 + 2] / 255;
  }
  return float32;
}

export async function detectObjects(imageUri: string): Promise<Detection[]> {
  const m = await loadDetectionModel();
  const input = await imageUriToFloat32(imageUri);
  const outputs = await m.run([input.buffer as ArrayBuffer]);

  // YOLOv10n TFLite output: [1, 300, 6]
  // 300 detections × [x1, y1, x2, y2, confidence, class_id]
  // NMS-free: 중복 없음, 후처리 불필요
  const rawOutput = new Float32Array(outputs[0]);
  const detections: Detection[] = [];

  for (let i = 0; i < MAX_DETECTIONS; i++) {
    const offset = i * 6;
    const x1 = rawOutput[offset];
    const y1 = rawOutput[offset + 1];
    const x2 = rawOutput[offset + 2];
    const y2 = rawOutput[offset + 3];
    const confidence = rawOutput[offset + 4];
    const classId = Math.round(rawOutput[offset + 5]);

    if (confidence < CONFIDENCE_THRESHOLD) continue;
    if (classId < 0 || classId >= COCO_CLASSES.length) continue;

    detections.push({
      label: COCO_CLASSES[classId],
      confidence,
      bbox: [x1, y1, x2 - x1, y2 - y1],
    });
  }

  detections.sort((a, b) => b.confidence - a.confidence);
  return detections.slice(0, 10);
}

export const MISSION_COCO_LABELS: Record<string, string[]> = {
  'tv': ['tv', 'laptop'],
  'bathtub': ['sink', 'toilet'],
  'menu-book': ['book'],
  'school': ['book', 'laptop'],
  'toys': ['teddy bear', 'sports ball'],
  'sports-esports': ['remote', 'cell phone'],
  'outdoor-grill': ['oven', 'microwave', 'knife'],
  'fitness-center': ['sports ball', 'bench'],
  'directions-run': ['person'],
  'self-improvement': ['person'],
  'music-note': ['keyboard'],
  'brush': ['scissors'],
  'pets': ['dog', 'cat', 'bird'],
  'local-cafe': ['cup', 'bowl'],
  'restaurant': ['fork', 'knife', 'spoon', 'bowl'],
  'shopping-cart': ['handbag', 'backpack', 'suitcase'],
  'work': ['laptop', 'keyboard', 'mouse'],
  'computer': ['laptop', 'keyboard', 'mouse'],
  'phone-android': ['cell phone'],
  'camera-alt': [],
  'directions-bike': ['bicycle'],
  'spa': ['sink', 'toilet'],
  'nightlight': ['bed'],
  'clean-hands': ['sink'],
};
