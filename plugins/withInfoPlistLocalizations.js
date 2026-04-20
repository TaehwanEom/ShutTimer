// @v1.5 — iOS 권한 다이얼로그 14언어 다국어 지원
// prebuild 시 ios/<projectName>/<lang>.lproj/InfoPlist.strings 자동 생성.
// app.json infoPlist의 권한 텍스트는 fallback (사용자 언어가 lproj에 없을 때).

const { withDangerousMod, withInfoPlist } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// iOS lproj 식별자 매핑 — Apple 표준
const LANG_TO_LPROJ = {
  'ko': 'ko',
  'en': 'en',
  'ja': 'ja',
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'fr': 'fr',
  'de': 'de',
  'es': 'es',
  'pt-BR': 'pt-BR',
  'it': 'it',
  'tr': 'tr',
  'ar': 'ar',
  'th': 'th',
  'id': 'id',
};

// 4 권한 키 × 14 언어 텍스트
const TRANSLATIONS = {
  ko: {
    NSCameraUsageDescription: '사진을 스캔하여 타이머를 종료합니다.',
    NSLocationWhenInUseUsageDescription: '광고 개인화에 사용됩니다. 거부해도 앱 사용에 제약이 없습니다.',
    NSMotionUsageDescription: '흔들기로 알람을 종료하기 위해 동작 센서를 사용합니다.',
    NSUserTrackingUsageDescription: '이 식별자는 맞춤형 광고 제공에 사용됩니다.',
  },
  en: {
    NSCameraUsageDescription: 'Scan a photo to dismiss the timer.',
    NSLocationWhenInUseUsageDescription: 'Used to provide more relevant ads. Denying does not affect app functionality.',
    NSMotionUsageDescription: 'Used to detect shake gesture to dismiss the alarm.',
    NSUserTrackingUsageDescription: 'This identifier is used to provide personalized ads.',
  },
  ja: {
    NSCameraUsageDescription: '写真をスキャンしてタイマーを終了します。',
    NSLocationWhenInUseUsageDescription: '広告のパーソナライズに使用されます。拒否してもアプリの利用に支障はありません。',
    NSMotionUsageDescription: 'シェイクジェスチャーでアラームを止めるために動作センサーを使用します。',
    NSUserTrackingUsageDescription: 'この識別子はパーソナライズされた広告の提供に使用されます。',
  },
  'zh-CN': {
    NSCameraUsageDescription: '扫描照片以关闭定时器。',
    NSLocationWhenInUseUsageDescription: '用于个性化广告。拒绝不会影响应用功能。',
    NSMotionUsageDescription: '用于检测摇动手势以关闭闹钟。',
    NSUserTrackingUsageDescription: '此标识符用于提供个性化广告。',
  },
  'zh-TW': {
    NSCameraUsageDescription: '掃描照片以關閉計時器。',
    NSLocationWhenInUseUsageDescription: '用於個人化廣告。拒絕不會影響應用程式功能。',
    NSMotionUsageDescription: '用於偵測搖動手勢以關閉鬧鐘。',
    NSUserTrackingUsageDescription: '此識別碼用於提供個人化廣告。',
  },
  fr: {
    NSCameraUsageDescription: "Scannez une photo pour arrêter le minuteur.",
    NSLocationWhenInUseUsageDescription: "Utilisé pour personnaliser les publicités. Le refus n'affecte pas l'utilisation de l'application.",
    NSMotionUsageDescription: "Utilisé pour détecter le geste de secouage pour arrêter l'alarme.",
    NSUserTrackingUsageDescription: 'Cet identifiant est utilisé pour fournir des publicités personnalisées.',
  },
  de: {
    NSCameraUsageDescription: 'Scannen Sie ein Foto, um den Timer zu beenden.',
    NSLocationWhenInUseUsageDescription: 'Wird zur Personalisierung von Anzeigen verwendet. Die Ablehnung beeinträchtigt die App-Nutzung nicht.',
    NSMotionUsageDescription: 'Wird verwendet, um Schüttelgesten zum Beenden des Alarms zu erkennen.',
    NSUserTrackingUsageDescription: 'Diese Kennung wird verwendet, um personalisierte Anzeigen bereitzustellen.',
  },
  es: {
    NSCameraUsageDescription: 'Escanea una foto para detener el temporizador.',
    NSLocationWhenInUseUsageDescription: 'Se usa para personalizar anuncios. Rechazar no afecta el uso de la app.',
    NSMotionUsageDescription: 'Se usa para detectar el gesto de agitar para detener la alarma.',
    NSUserTrackingUsageDescription: 'Este identificador se usa para mostrar anuncios personalizados.',
  },
  'pt-BR': {
    NSCameraUsageDescription: 'Escaneie uma foto para encerrar o cronômetro.',
    NSLocationWhenInUseUsageDescription: 'Usado para personalizar anúncios. A recusa não afeta o uso do app.',
    NSMotionUsageDescription: 'Usado para detectar o gesto de agitar para parar o alarme.',
    NSUserTrackingUsageDescription: 'Este identificador é usado para exibir anúncios personalizados.',
  },
  it: {
    NSCameraUsageDescription: 'Scansiona una foto per terminare il timer.',
    NSLocationWhenInUseUsageDescription: "Utilizzato per personalizzare gli annunci. Rifiutare non influisce sull'uso dell'app.",
    NSMotionUsageDescription: 'Utilizzato per rilevare il gesto di scuotimento per fermare la sveglia.',
    NSUserTrackingUsageDescription: 'Questo identificatore viene utilizzato per fornire annunci personalizzati.',
  },
  tr: {
    NSCameraUsageDescription: 'Zamanlayıcıyı sonlandırmak için bir fotoğraf tarayın.',
    NSLocationWhenInUseUsageDescription: 'Reklamları kişiselleştirmek için kullanılır. Reddetmek uygulama kullanımını etkilemez.',
    NSMotionUsageDescription: 'Alarmı durdurmak için sallama hareketini algılamak için kullanılır.',
    NSUserTrackingUsageDescription: 'Bu tanımlayıcı kişiselleştirilmiş reklamlar sunmak için kullanılır.',
  },
  ar: {
    NSCameraUsageDescription: 'امسح صورة لإيقاف المؤقت.',
    NSLocationWhenInUseUsageDescription: 'يُستخدم لتخصيص الإعلانات. الرفض لا يؤثر على استخدام التطبيق.',
    NSMotionUsageDescription: 'يُستخدم لاكتشاف إيماءة الهز لإيقاف المنبه.',
    NSUserTrackingUsageDescription: 'يُستخدم هذا المعرف لتقديم إعلانات مخصصة.',
  },
  th: {
    NSCameraUsageDescription: 'สแกนภาพเพื่อปิดตัวจับเวลา',
    NSLocationWhenInUseUsageDescription: 'ใช้เพื่อปรับโฆษณาให้เหมาะสม การปฏิเสธไม่ส่งผลต่อการใช้งานแอป',
    NSMotionUsageDescription: 'ใช้เพื่อตรวจจับการเขย่าเพื่อปิดการแจ้งเตือน',
    NSUserTrackingUsageDescription: 'ตัวระบุนี้ใช้เพื่อแสดงโฆษณาเฉพาะบุคคล',
  },
  id: {
    NSCameraUsageDescription: 'Pindai foto untuk mematikan pengatur waktu.',
    NSLocationWhenInUseUsageDescription: 'Digunakan untuk personalisasi iklan. Penolakan tidak memengaruhi penggunaan aplikasi.',
    NSMotionUsageDescription: 'Digunakan untuk mendeteksi gerakan goyang untuk mematikan alarm.',
    NSUserTrackingUsageDescription: 'Pengidentifikasi ini digunakan untuk menyediakan iklan yang dipersonalisasi.',
  },
};

const escapeStringValue = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const buildStringsContent = (strings) => {
  return Object.entries(strings)
    .map(([key, value]) => `"${key}" = "${escapeStringValue(value)}";`)
    .join('\n') + '\n';
};

const withInfoPlistLocalizations = (config) => {
  // 1) CFBundleLocalizations 등록 (지원 언어 명시)
  config = withInfoPlist(config, (config) => {
    config.modResults.CFBundleLocalizations = Object.values(LANG_TO_LPROJ);
    // 기본 development region 영어 (fallback)
    if (!config.modResults.CFBundleDevelopmentRegion) {
      config.modResults.CFBundleDevelopmentRegion = 'en';
    }
    return config;
  });

  // 2) lproj 폴더 + InfoPlist.strings 자동 생성 (prebuild 시점)
  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const projectName = config.modRequest.projectName || 'ShutTimer';
      const iosAppRoot = path.join(projectRoot, 'ios', projectName);

      if (!fs.existsSync(iosAppRoot)) {
        console.warn(`[withInfoPlistLocalizations] iOS app root not found: ${iosAppRoot}`);
        return config;
      }

      for (const [langKey, strings] of Object.entries(TRANSLATIONS)) {
        const lprojDir = LANG_TO_LPROJ[langKey];
        if (!lprojDir) continue;
        const lprojPath = path.join(iosAppRoot, `${lprojDir}.lproj`);
        if (!fs.existsSync(lprojPath)) {
          fs.mkdirSync(lprojPath, { recursive: true });
        }
        const stringsPath = path.join(lprojPath, 'InfoPlist.strings');
        // UTF-16 BOM + UTF-8 둘 다 지원하나, 안정성 위해 UTF-8 (Xcode 12+ 기본 호환)
        fs.writeFileSync(stringsPath, buildStringsContent(strings), 'utf8');
        console.log(`[withInfoPlistLocalizations] Wrote ${stringsPath}`);
      }

      return config;
    },
  ]);

  return config;
};

module.exports = withInfoPlistLocalizations;
