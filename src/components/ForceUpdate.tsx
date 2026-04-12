import React, { useEffect, useState } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, Platform, Linking } from 'react-native';
import * as Application from 'expo-application';
import { useTranslation } from 'react-i18next';

const VERSION_URL = 'https://taehwaneom.github.io/shuttimer-config/version.json';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.shuttimer.app';
const APP_STORE_URL = 'https://apps.apple.com/app/shuttimer/id6761991860';

function compareVersions(current: string, required: string): boolean {
  const c = current.split('.').map(Number);
  const r = required.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((c[i] ?? 0) < (r[i] ?? 0)) return true;
    if ((c[i] ?? 0) > (r[i] ?? 0)) return false;
  }
  return false;
}

export default function ForceUpdate() {
  const { t } = useTranslation();
  const [needsUpdate, setNeedsUpdate] = useState(false);

  useEffect(() => {
    fetch(VERSION_URL)
      .then(res => res.json())
      .then(data => {
        const currentVersion = Application.nativeApplicationVersion ?? '0.0.0';
        if (compareVersions(currentVersion, data.min_version)) {
          setNeedsUpdate(true);
        }
      })
      .catch(() => {});
  }, []);

  if (!needsUpdate) return null;

  const storeUrl = Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;

  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('forceUpdate.title')}</Text>
          <Text style={styles.message}>{t('forceUpdate.message')}</Text>
          <TouchableOpacity style={styles.button} onPress={() => Linking.openURL(storeUrl)}>
            <Text style={styles.buttonText}>{t('forceUpdate.button')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '80%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1a1c1f',
  },
  message: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#dc3535',
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
  },
});
