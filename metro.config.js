const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// TFLite 모델 파일을 require()로 로드하기 위해 assetExts에 추가
config.resolver.assetExts.push('tflite');

module.exports = config;
