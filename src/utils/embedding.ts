import { loadTensorflowModel } from 'react-native-fast-tflite';
import type { TfliteModel } from 'react-native-fast-tflite/lib/typescript/specs/Tflite.nitro';
import * as ImageManipulator from 'expo-image-manipulator';
import jpeg from 'jpeg-js';

// MobileNetV3 Large feature_vector — 224x224 RGB 입력, 1280차원 임베딩 출력
const INPUT_SIZE = 224;
const EMBEDDING_DIM = 1280;

let model: TfliteModel | null = null;
let loadPromise: Promise<TfliteModel> | null = null;

export async function loadEmbeddingModel(): Promise<TfliteModel> {
  if (model) return model;
  if (!loadPromise) {
    loadPromise = loadTensorflowModel(
      require('../../assets/models/mobilenet_v3_large.tflite'),
      []
    );
  }
  model = await loadPromise;
  return model;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = global.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function imageUriToFloat32(imageUri: string): Promise<Float32Array> {
  // 1. 224x224로 리사이즈 + JPEG base64 출력
  const manipulated = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: INPUT_SIZE, height: INPUT_SIZE } }],
    {
      compress: 1,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    }
  );

  if (!manipulated.base64) {
    throw new Error('Failed to encode image to base64');
  }

  // 2. base64 → Uint8Array (JPEG bytes)
  const jpegBytes = base64ToUint8Array(manipulated.base64);

  // 3. JPEG decode → RGBA pixels
  const decoded = jpeg.decode(jpegBytes, { useTArray: true });

  // 4. RGBA → RGB Float32 normalized [0, 1]
  const float32 = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    float32[i * 3] = decoded.data[i * 4] / 255;
    float32[i * 3 + 1] = decoded.data[i * 4 + 1] / 255;
    float32[i * 3 + 2] = decoded.data[i * 4 + 2] / 255;
  }
  return float32;
}

export async function extractEmbedding(imageUri: string): Promise<Float32Array> {
  const m = await loadEmbeddingModel();
  const input = await imageUriToFloat32(imageUri);
  const outputs = await m.run([input.buffer as ArrayBuffer]);
  const embedding = new Float32Array(outputs[0]);
  if (embedding.length !== EMBEDDING_DIM) {
    throw new Error(`Expected ${EMBEDDING_DIM}d embedding, got ${embedding.length}d`);
  }
  return embedding;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// 사용자 등록 사진과의 최대 유사도 ≥ 이 값 → 통과 (D1: 0.85 강제)
export const EMBEDDING_THRESHOLD = 0.85;
