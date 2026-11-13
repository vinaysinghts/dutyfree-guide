import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { Button, Card, Muted } from '@/components/ui';
import { useTravelDay } from '@/lib/travelDay';

/**
 * "You're at DXB: snap one shelf." Shown on travel day (from the trip dates) or when the
 * phone is at a trip airport. One tap opens the camera with the airport already chosen.
 * Works on web too, where there are no reminders. ADR-0014.
 */
export function TravelDayCard() {
  const { active, dismiss } = useTravelDay();
  if (!active) return null;
  const { iata, date, here } = active;
  return (
    <Card highlight>
      <Text style={styles.title}>{here ? `📍 You're at ${iata}` : `✈️ Flying through ${iata} today?`}</Text>
      <Muted>
        If you pass duty free, snap one shelf tag. We read the price for you, and the next traveller sees what you saw.
      </Muted>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button title="Snap a tag" onPress={() => router.push(`/report?airport=${iata}&snap=1&via=nudge_card`)} />
        </View>
        <View style={styles.flex}>
          <Button title="Not this time" variant="ghost" onPress={() => dismiss(iata, date)} />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontWeight: '700', fontSize: 16 },
  row: { flexDirection: 'row', gap: 8, backgroundColor: 'transparent', marginTop: 4 },
  flex: { flex: 1, backgroundColor: 'transparent' },
});
