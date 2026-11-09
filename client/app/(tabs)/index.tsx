import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { AirportSearch } from '@/components/AirportSearch';
import { Text, View } from '@/components/Themed';
import { Button, Card, Muted, useColors } from '@/components/ui';
import { isDemoMode } from '@/lib/supabase';
import { useTrip } from '@/lib/trip';

export default function TripScreen() {
  const c = useColors();
  const trip = useTrip();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Where are you flying?</Text>
      <Muted>Add every airport on your route, including layovers. We'll show where each bottle is cheapest.</Muted>
      {isDemoMode ? (
        <Muted style={{ color: c.warn }}>Demo mode: sample prices only (no backend configured).</Muted>
      ) : null}

      <AirportSearch onPick={trip.add} exclude={trip.airports.map((a) => a.iata)} />

      {trip.airports.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.subtitle}>Your route</Text>
          {trip.airports.map((a, i) => (
            <Card key={a.iata} style={styles.stop}>
              <Text style={styles.index}>{i + 1}</Text>
              <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                <Text style={{ fontWeight: '600' }}>{a.iata} · {a.city ?? a.name}</Text>
                <Muted>{a.name}</Muted>
              </View>
              <IconButton label="↑" hint={`Move ${a.iata} earlier`} onPress={() => trip.move(a.iata, -1)} disabled={i === 0} />
              <IconButton label="↓" hint={`Move ${a.iata} later`} onPress={() => trip.move(a.iata, 1)} disabled={i === trip.airports.length - 1} />
              <IconButton label="✕" hint={`Remove ${a.iata}`} onPress={() => trip.remove(a.iata)} />
            </Card>
          ))}
          <Button title="Compare prices" onPress={() => router.push('/prices')} />
          <Button title="Clear trip" variant="ghost" onPress={trip.clear} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function IconButton({ label, hint, onPress, disabled }: { label: string; hint: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable accessibilityLabel={hint} onPress={onPress} disabled={disabled} hitSlop={8} style={{ padding: 6, opacity: disabled ? 0.3 : 1 }}>
      <Text style={{ color: c.tint, fontSize: 18 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { fontSize: 18, fontWeight: '600' },
  section: { gap: 8, backgroundColor: 'transparent' },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  index: { fontWeight: '700', width: 20 },
});
