import { Linking, StyleSheet, Switch } from 'react-native';

import { Text, View } from '@/components/Themed';
import { Muted, useColors } from '@/components/ui';
import { useTravelDay } from '@/lib/travelDay';

/** Opt-in for travel-day reminders. Off by default; turning it on asks the OS permission. */
export function RemindersSwitch() {
  const c = useColors();
  const t = useTravelDay();
  if (!t.remindersSupported) {
    return <Muted>On the day you fly, open this page and we'll offer a one-tap price snap. (Reminders need the phone app.)</Muted>;
  }
  const hasDates = t.stops.some((s) => s.date);
  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <View style={{ flex: 1, backgroundColor: 'transparent' }}>
          <Text style={{ fontWeight: '600' }}>Remind me on travel day</Text>
          <Muted>
            At most one reminder per airport and two a day, about 75 minutes before your flight (or 08:00 if you
            didn't give a time). Your dates stay on this phone.
          </Muted>
        </View>
        <Switch
          value={t.remindersOn && t.permission === 'granted'}
          onValueChange={(on) => t.setRemindersOn(on)}
          accessibilityLabel="Travel-day reminders"
        />
      </View>
      {t.remindersOn && !hasDates ? <Muted style={{ color: c.warn }}>Add a date to an airport above to get a reminder.</Muted> : null}
      {t.permission === 'denied' ? (
        <Text style={{ color: c.warn }} onPress={() => Linking.openSettings()}>
          Notifications are off for this app. Tap to open Settings.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 4, backgroundColor: 'transparent' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'transparent' },
});
