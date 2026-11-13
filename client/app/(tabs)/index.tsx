import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { AirportSearch } from '@/components/AirportSearch';
import { RemindersSwitch } from '@/components/RemindersSwitch';
import { StopPlanEditor } from '@/components/StopPlanEditor';
import { Text, View } from '@/components/Themed';
import { TravelDayCard } from '@/components/TravelDayCard';
import { Button, Card, Muted, useColors } from '@/components/ui';
import { isDemoMode } from '@/lib/supabase';
import { useTrip } from '@/lib/trip';

export default function TripScreen() {
  const c = useColors();
  const trip = useTrip();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <TravelDayCard />
      <Text style={styles.title}>Where are you flying?</Text>
      <Muted>Add each airport you'll pass through, including layovers. The order doesn't matter, and a return trip uses the same airports.</Muted>
      {isDemoMode ? (
        <Muted style={{ color: c.warn }}>Demo mode: sample prices only (no backend configured).</Muted>
      ) : null}

      <AirportSearch onPick={trip.add} exclude={trip.airports.map((a) => a.iata)} />

      {trip.airports.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.subtitle}>Your airports</Text>
          {trip.airports.map((a) => (
            <Card key={a.iata} style={styles.stop}>
              <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                <Text style={{ fontWeight: '600' }}>{a.iata} · {a.city ?? a.name}</Text>
                <Muted>{a.name}</Muted>
                <StopPlanEditor iata={a.iata} />
              </View>
              <IconButton label="✕" hint={`Remove ${a.iata}`} onPress={() => trip.remove(a.iata)} />
            </Card>
          ))}
          <RemindersSwitch />
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
});
