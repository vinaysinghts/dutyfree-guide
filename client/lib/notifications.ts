/**
 * Local (on-device) reminders for travel-day nudges, via expo-notifications.
 *
 * No server, no push token: the phone schedules the reminder itself, so it fires
 * even with roaming off at the airport, and the trip never leaves the device
 * (ADR-0014 §1). The web build uses notifications.web.ts, which does nothing.
 *
 * `reconcileReminders` is declarative: give it the reminders that *should* exist
 * (from planNudges) and it cancels or schedules until the OS matches. Callers can
 * run it on every change without double-booking.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { PlannedNudge } from './nudge';

export const remindersSupported = true;

const CHANNEL = 'travel-day';
const KIND = 'travel-nudge';

export type ReminderOpened = { id: string; iata: string };

let configured = false;

export function configureReminders() {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    // If the app is open when it fires, the in-app card is already showing the same ask.
    handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Travel-day reminders',
      description: 'One reminder per airport on the day you fly, to snap a duty-free price.',
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => {});
  }
}

export async function reminderPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

/** Asks only when the traveller turns reminders on: a cold prompt at launch gets refused. */
export async function requestReminderPermission(): Promise<boolean> {
  const p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: false, allowBadge: false } });
  return p.granted;
}

/** Makes the OS's scheduled reminders equal `planned`. Returns what it changed, for logs. */
export async function reconcileReminders(planned: PlannedNudge[], label: (iata: string) => string) {
  if ((await reminderPermission()) !== 'granted') return { scheduled: 0, cancelled: 0 };
  const existing = (await Notifications.getAllScheduledNotificationsAsync()).filter(
    (n) => n.content.data?.kind === KIND,
  );
  const want = new Map(planned.map((p) => [p.id, p]));
  let cancelled = 0;
  let scheduled = 0;
  for (const n of existing) {
    const p = want.get(n.identifier);
    // Same id but a different time (the flight time changed): replace it.
    if (!p || n.content.data?.fireAt !== p.fireAt.toISOString()) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
      cancelled++;
    } else {
      want.delete(n.identifier);
    }
  }
  for (const p of want.values()) {
    const name = label(p.iata);
    await Notifications.scheduleNotificationAsync({
      identifier: p.id,
      content: {
        title: `At ${name} duty free?`,
        body: 'Snap one shelf of prices. It takes ten seconds, and the next traveller sees what you saw.',
        data: { kind: KIND, iata: p.iata, fireAt: p.fireAt.toISOString(), url: `/report?airport=${p.iata}&snap=1&via=nudge_notification&nudge=${encodeURIComponent(p.id)}` },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.fireAt, channelId: CHANNEL },
    });
    scheduled++;
  }
  return { scheduled, cancelled };
}

/** Cancels every travel-day reminder (the traveller turned them off). */
export async function cancelAllReminders() {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    existing.filter((n) => n.content.data?.kind === KIND).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/**
 * Calls `cb` when the traveller taps a reminder, including the tap that launched the app
 * from cold (which happens before any listener exists, hence getLastNotificationResponse).
 */
export function onReminderOpened(cb: (opened: ReminderOpened & { url: string }) => void): () => void {
  const handle = (r: Notifications.NotificationResponse | null) => {
    const data = r?.notification.request.content.data;
    if (!r || data?.kind !== KIND) return;
    Notifications.clearLastNotificationResponse();
    cb({ id: r.notification.request.identifier, iata: String(data.iata), url: String(data.url) });
  };
  handle(Notifications.getLastNotificationResponse());
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
