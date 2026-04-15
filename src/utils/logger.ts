import AsyncStorage from '@react-native-async-storage/async-storage';

// 각 로그를 독립된 키로 저장. read-modify-write 경쟁 조건 완전 제거.
const LOG_KEY_PREFIX = 'app_debug_log_entry_';
const MAX_LOGS = 200;

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  tag: string;
  message: string;
}

let entryCounter = 0;

const saveEntry = (entry: LogEntry) => {
  entryCounter += 1;
  const key = `${LOG_KEY_PREFIX}${entry.timestamp}_${entryCounter}`;
  AsyncStorage.setItem(key, JSON.stringify(entry)).catch((e) => {
    console.warn('Logger save failed:', e);
  });
};

export const Logger = {
  info: (tag: string, message: string) => {
    console.log(`[${tag}] ${message}`);
    saveEntry({ timestamp: new Date().toISOString(), level: 'info', tag, message });
  },

  warn: (tag: string, message: string) => {
    console.warn(`[${tag}] ${message}`);
    saveEntry({ timestamp: new Date().toISOString(), level: 'warn', tag, message });
  },

  error: (tag: string, error: unknown) => {
    const errorStr = error instanceof Error ? error.message : String(error);
    console.error(`[${tag}] ${errorStr}`);
    saveEntry({ timestamp: new Date().toISOString(), level: 'error', tag, message: errorStr });
  },

  getLogs: async (): Promise<LogEntry[]> => {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const logKeys = allKeys.filter((k) => k.startsWith(LOG_KEY_PREFIX));
      if (logKeys.length === 0) return [];
      const pairs = await AsyncStorage.multiGet(logKeys);
      const entries: LogEntry[] = [];
      for (const [, value] of pairs) {
        if (!value) continue;
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === 'object' && parsed.timestamp) {
            entries.push(parsed as LogEntry);
          }
        } catch {
          // 손상된 항목은 건너뜀
        }
      }
      entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return entries.slice(0, MAX_LOGS);
    } catch {
      return [];
    }
  },

  clearLogs: async () => {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const logKeys = allKeys.filter((k) => k.startsWith(LOG_KEY_PREFIX));
      if (logKeys.length > 0) {
        await AsyncStorage.multiRemove(logKeys);
      }
    } catch (e) {
      console.warn('Failed to clear logs:', e);
    }
  },
};

// 모듈 로드 시 자기 확인 로그 — Logger 작동 여부 검증용
Logger.info('Logger', 'initialized');
