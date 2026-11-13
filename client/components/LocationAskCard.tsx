import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { Button, Card, Muted } from '@/components/ui';
import { useTravelDay } from '@/lib/travelDay';

/**
 * A one-time explainer before the OS location prompt. Asking cold gets refused, and iOS only
 * lets us ask once, so we say what it's for first and only prompt if they tap Allow.
 */
export function LocationAskCard() {
  const t = useTravelDay();
  if (!t.showLocationAsk) return null;
  return (
    <Card>
      <Text style={styles.title}>Notice when I'm at an airport?</Text>
      <Muted>
        When you open the app at an airport, we'll offer a one-tap snap of a duty-free price tag. We check your
        location only while the app is open, never in the background, and it stays on your phone.
      </Muted>
      <View style={styles.row}>
        <View style={styles.flex}><Button title="Allow" onPress={() => t.allowLocation()} /></View>
        <View style={styles.flex}><Button title="Not now" variant="ghost" onPress={t.declineLocationAsk} /></View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontWeight: '700', fontSize: 16 },
  row: { flexDirection: 'row', gap: 8, backgroundColor: 'transparent', marginTop: 4 },
  flex: { flex: 1, backgroundColor: 'transparent' },
});
