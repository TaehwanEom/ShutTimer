import React, { ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Logger } from '../utils/logger';
// 클래스 컴포넌트라 useTranslation 훅 불가 → i18n 인스턴스 직접 사용 (routineScheduler와 동일).
import i18n from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    Logger.error('ErrorBoundary', '=== ERROR BOUNDARY CAUGHT ===');
    Logger.error('ErrorBoundary', error);
    Logger.error('ErrorBoundary', `Stack: ${errorInfo.componentStack ?? '(no stack)'}`);

    this.setState({
      error,
      errorInfo,
    });

    // AsyncStorage에 에러 저장
    this.saveErrorLog(error, errorInfo);
  }

  private saveErrorLog = async (error: Error, errorInfo: React.ErrorInfo) => {
    try {
      const timestamp = new Date().toISOString();
      const errorMsg = `${timestamp}\n${error.toString()}\n${errorInfo.componentStack}`;

      const prev = await AsyncStorage.getItem('app_error_log');
      const logs = JSON.parse(prev || '[]') as string[];
      logs.unshift(errorMsg);
      const limited = logs.slice(0, 20); // 최대 20개 유지

      await AsyncStorage.setItem('app_error_log', JSON.stringify(limited));
    } catch (e) {
      Logger.warn('ErrorBoundary', `Failed to save error log: ${String(e)}`);
    }
  };

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  private handleShare = async () => {
    const timestamp = new Date().toISOString();
    const message = `[ShutTimer 오류 리포트 ${timestamp}]\n\n` +
      `에러: ${this.state.error?.toString() ?? 'unknown'}\n\n` +
      `스택:\n${this.state.errorInfo?.componentStack ?? ''}`;
    try {
      await Share.share({ message });
    } catch {
      // 공유 취소 등은 무시
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.content}>
            <Text style={styles.title}>⚠️ {i18n.t('errorBoundary.title', { defaultValue: '앱 오류 발생' })}</Text>

            <ScrollView style={styles.errorBox}>
              <Text style={styles.errorTitle}>{i18n.t('errorBoundary.errorLabel', { defaultValue: '에러 메시지:' })}</Text>
              <Text selectable style={styles.errorText}>
                {this.state.error?.toString()}
              </Text>

              <Text style={styles.stackTitle}>{i18n.t('errorBoundary.stackLabel', { defaultValue: '스택 트레이스:' })}</Text>
              <Text selectable style={styles.stackText}>
                {this.state.errorInfo?.componentStack}
              </Text>
            </ScrollView>

            <Text style={styles.instruction}>
              {i18n.t('errorBoundary.instruction', { defaultValue: '아래 "공유" 버튼으로 개발자에게 에러 전체 전송 가능' })}
            </Text>

            <TouchableOpacity
              style={[styles.button, styles.shareButton]}
              onPress={this.handleShare}
            >
              <Text style={styles.buttonText}>{i18n.t('errorBoundary.shareBtn', { defaultValue: '에러 공유 / 복사' })}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.button}
              onPress={this.handleReset}
            >
              <Text style={styles.buttonText}>{i18n.t('errorBoundary.restartBtn', { defaultValue: '앱 다시 시작' })}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff3cd',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  content: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#333',
    marginBottom: 16,
    textAlign: 'center',
  },
  errorBox: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#d32f2f',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 12,
    color: '#333',
    fontFamily: 'Courier New',
    marginBottom: 12,
    lineHeight: 18,
  },
  stackTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#d32f2f',
    marginBottom: 8,
    marginTop: 12,
  },
  stackText: {
    fontSize: 11,
    color: '#666',
    fontFamily: 'Courier New',
    lineHeight: 16,
  },
  instruction: {
    fontSize: 13,
    color: '#555',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#dc3535',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  shareButton: {
    backgroundColor: '#1e88e5',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
  },
});
