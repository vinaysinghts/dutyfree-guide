import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { Text, View } from './Themed';
import { Button, Muted } from './ui';

const KEY = 'ageGate.confirmed.v1';

/** App stores require an age check for alcohol-related apps. */
export function AgeGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ask' | 'ok' | 'under'>('loading');

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => setState(v === 'yes' ? 'ok' : 'ask'))
      .catch(() => setState('ask'));
  }, []);

  if (state === 'ok') return <>{children}</>;
  if (state === 'loading') return <View style={styles.wrap} />;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Duty Free Guide</Text>
      {state === 'under' ? (
        <Muted style={styles.center}>Sorry, you need to be of legal drinking age to use this app.</Muted>
      ) : (
        <>
          <Muted style={styles.center}>
            This app shows alcohol prices. Please confirm you are of legal drinking age in your country (18+ or older where required).
          </Muted>
          <Button
            title="I am of legal drinking age"
            onPress={() => {
              AsyncStorage.setItem(KEY, 'yes').catch(() => {});
              setState('ok');
            }}
          />
          <Button title="I am not" variant="ghost" onPress={() => setState('under')} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  center: { textAlign: 'center', fontSize: 15 },
});
