import AsyncStorage from '@react-native-async-storage/async-storage';

const LOG_STORAGE_KEY = 'app_debug_log';
const MAX_LOGS = 200;

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  tag: string;
  message: string;
}

// 모든 저장 작업을 순차 실행. 동시 read-modify-write로 인한 로그 유실 방지.
let saveQueue: Promise<void> = Promise.resolve();

const enqueueSave = (entry: LogEntry) => {
  saveQueue = saveQueue.then(async () => {
    try {
      const prev = await AsyncStorage.getItem(LOG_STORAGE_KEY);
      let logs: LogEntry[] = [];
      if (prev) {
        try {
          const parsed = JSON.parse(prev);
          if (Array.isArray(parsed)) logs = parsed;
        } catch {
          // 손상된 JSON이면 새로 시작
        }
      }
      logs.unshift(entry);
      const limited = logs.slice(0, MAX_LOGS);
      await AsyncStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(limited));
    } catch (e) {
      console.warn('Logger._save failed:', e);
    }
  });
};

export const Logger = {
  info: (tag: string, message: string) => {
    console.log(`[${tag}] ${message}`);
    enqueueSave({ timestamp: new Date().toISOString(), level: 'info', tag, message });
  },

  warn: (tag: string, message: string) => {
    console.warn(`[${tag}] ${message}`);
    enqueueSave({ timestamp: new Date().toISOString(), level: 'warn', tag, message });
  },

  error: (tag: string, error: unknown) => {
    const errorStr = error instanceof Error ? error.message : String(error);
    console.error(`[${tag}] ${errorStr}`);
    enqueueSave({ timestamp: new Date().toISOString(), level: 'error', tag, message: errorStr });
  },

  getLogs: async (): Promise<LogEntry[]> => {
    try {
      const data = await AsyncStorage.getItem(LOG_STORAGE_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  clearLogs: async () => {
    saveQueue = saveQueue.then(async () => {
      try {
        await AsyncStorage.removeItem(LOG_STORAGE_KEY);
      } catch (e) {
        console.warn('Failed to clear logs:', e);
      }
    });
    return saveQueue;
  },
};

// 모듈 로드 시 자기 확인 로그 — Logger 작동 여부 검증용
Logger.info('Logger', 'initialized');
