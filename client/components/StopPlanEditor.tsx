import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { Chip, Input, Muted, useColors } from '@/components/ui';
import { airportTimeZone } from '@/lib/airports';
import { dateChoices } from '@/lib/nudge';
import { useTrip, type StopPlan } from '@/lib/trip';
import { isLocalDate, isLocalTime } from '@/lib/zonedTime';

/**
 * "When are you at this airport?" Optional: a date (airport-local) and, if known, the
 * flight's departure time from there. Plain fields rather than a date-picker dependency;
 * Today/Tomorrow chips cover the common case of setting it up just before flying.
 */
export function StopPlanEditor({ iata }: { iata: string }) {
  const c = useColors();
  const trip = useTrip();
  const plan = trip.plans[iata] ?? {};
  const [open, setOpen] = useState(false);
  const [dateText, setDateText] = useState(plan.date ?? '');
  const [timeText, setTimeText] = useState(plan.time ?? '');
  const tz = airportTimeZone(iata);

  const save = (next: StopPlan) => trip.setPlan(iata, next);

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`Set when you're at ${iata}`}>
        <Text style={{ color: c.tint, fontSize: 13 }}>
          {plan.date ? `🗓 ${plan.date}${plan.time ? `, flight ${plan.time}` : ''} (${iata} time)` : '+ When are you here? (optional)'}
        </Text>
      </Pressable>
    );
  }

  const dateBad = dateText !== '' && !isLocalDate(dateText);
  const timeBad = timeText !== '' && !isLocalTime(timeText);
  return (
    <View style={styles.box}>
      <View style={styles.chips}>
        {dateChoices(new Date(), tz).map((d) => (
          <Chip
            key={d.label}
            label={d.label}
            selected={plan.date === d.date}
            onPress={() => {
              setDateText(d.date);
              save({ ...plan, date: d.date });
            }}
          />
        ))}
      </View>
      <Input
        label={`Date at ${iata} (YYYY-MM-DD, ${iata} time)`}
        value={dateText}
        onChangeText={(t) => {
          setDateText(t);
          if (t === '' || isLocalDate(t)) save({ ...plan, date: t || undefined });
        }}
        placeholder="2026-11-20"
        autoCapitalize="none"
      />
      {dateBad ? <Muted style={{ color: c.danger }}>Use a date like 2026-11-20.</Muted> : null}
      <Input
        label={`Flight leaves ${iata} at (HH:MM, optional)`}
        value={timeText}
        onChangeText={(t) => {
          setTimeText(t);
          if (t === '' || isLocalTime(t)) save({ ...plan, time: t || undefined });
        }}
        placeholder="09:40"
        keyboardType="numbers-and-punctuation"
      />
      {timeBad ? <Muted style={{ color: c.danger }}>Use 24-hour time like 09:40.</Muted> : null}
      <Pressable onPress={() => setOpen(false)}>
        <Text style={{ color: c.tint, fontWeight: '600' }}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6, backgroundColor: 'transparent', marginTop: 4 },
  chips: { flexDirection: 'row', gap: 6, backgroundColor: 'transparent' },
});
