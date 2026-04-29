import AsyncStorage from '@react-native-async-storage/async-storage';

// 메모리 버퍼가 primary. AsyncStorage는 best-effort 백업.
// AsyncStorage 어떤 이유로든 실패해도 세션 동안 로그는 반드시 보임.

const MEMORY_BUFFER_KEY = 'app_debug_log_memory_v2';
const MAX_LOGS = 200;

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  tag: string;
  message: string;
}

const memoryBuffer: LogEntry[] = [];

const pushToMemory = (entry: LogEntry) => {
  memoryBuffer.unshift(entry);
  if (memoryBuffer.length > MAX_LOGS) memoryBuffer.length = MAX_LOGS;
};

// 백그라운드로 스토리지 반영 (실패해도 메모리엔 이미 있음)
const persistAll = () => {
  try {
    const snapshot = JSON.stringify(memoryBuffer);
    AsyncStorage.setItem(MEMORY_BUFFER_KEY, snapshot).catch((e) => {
      console.warn('Logger persist failed:', e);
    });
  } catch (e) {
    console.warn('Logger persist error:', e);
  }
};

const record = (level: 'info' | 'warn' | 'error', tag: string, message: string) => {
  // v1.6 hotfix — production 빌드에서도 AsyncStorage 저장 (TestFlight console 미라우팅 회피).
  // 디버그 화면에서 Logger.getLogs() 로 조회.
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    tag,
    message,
  };
  pushToMemory(entry);
  persistAll();
};

// 앱 시작 시 이전 세션 로그 복원 시도 (실패 무시)
AsyncStorage.getItem(MEMORY_BUFFER_KEY)
  .then((raw) => {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // 기존 메모리 앞에 과거 로그를 붙임 (새 로그 유지)
        for (const item of parsed) {
          if (item && typeof item === 'object' && item.timestamp) {
            memoryBuffer.push(item as LogEntry);
          }
        }
        if (memoryBuffer.length > MAX_LOGS) memoryBuffer.length = MAX_LOGS;
      }
    } catch {
      // 손상 무시
    }
  })
  .catch(() => {});

export const Logger = {
  info: (tag: string, message: string) => {
    console.log(`[${tag}] ${message}`);
    record('info', tag, message);
  },

  warn: (tag: string, message: string) => {
    console.warn(`[${tag}] ${message}`);
    record('warn', tag, message);
  },

  error: (tag: string, error: unknown) => {
    const errorStr = error instanceof Error ? error.message : String(error);
    console.error(`[${tag}] ${errorStr}`);
    record('error', tag, errorStr);
  },

  getLogs: async (): Promise<LogEntry[]> => {
    // 메모리 버퍼 직접 반환 (AsyncStorage 무관)
    return [...memoryBuffer];
  },

  clearLogs: async () => {
    memoryBuffer.length = 0;
    try {
      await AsyncStorage.removeItem(MEMORY_BUFFER_KEY);
    } catch (e) {
      console.warn('Failed to clear logs:', e);
    }
  },
};

// 모듈 로드 시 자기 확인 로그
Logger.info('Logger', 'initialized (memory-first v2)');
