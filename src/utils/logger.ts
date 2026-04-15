import AsyncStorage from '@react-native-async-storage/async-storage';

const LOG_STORAGE_KEY = 'app_debug_log';
const MAX_LOGS = 200;

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  tag: string;
  message: string;
}

export const Logger = {
  info: (tag: string, message: string) => {
    const msg = `[${tag}] ${message}`;
    console.log(msg);
    Logger._save('info', tag, message);
  },

  warn: (tag: string, message: string) => {
    const msg = `[${tag}] ${message}`;
    console.warn(msg);
    Logger._save('warn', tag, message);
  },

  error: (tag: string, error: unknown) => {
    const errorStr = error instanceof Error ? error.message : String(error);
    const msg = `[${tag}] ${errorStr}`;
    console.error(msg);
    Logger._save('error', tag, errorStr);
  },

  _save: async (
    level: 'info' | 'warn' | 'error',
    tag: string,
    message: string
  ) => {
    try {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        tag,
        message,
      };

      const prev = await AsyncStorage.getItem(LOG_STORAGE_KEY);
      const logs: LogEntry[] = JSON.parse(prev || '[]');
      logs.unshift(entry);
      const limited = logs.slice(0, MAX_LOGS);

      await AsyncStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(limited));
    } catch (e) {
      // 로그 저장 실패는 조용히 무시
    }
  },

  getLogs: async (): Promise<LogEntry[]> => {
    try {
      const data = await AsyncStorage.getItem(LOG_STORAGE_KEY);
      return JSON.parse(data || '[]');
    } catch {
      return [];
    }
  },

  clearLogs: async () => {
    try {
      await AsyncStorage.removeItem(LOG_STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear logs:', e);
    }
  },
};
