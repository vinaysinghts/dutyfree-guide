/**
 * Web has no local scheduled notifications (Web Push needs a server and a service
 * worker, ADR-0014 §1), so the web app relies on the in-app travel-day card only.
 */
import type { PlannedNudge } from './nudge';

export const remindersSupported = false;
export type ReminderOpened = { id: string; iata: string };

export function configureReminders() {}
export async function reminderPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  return 'denied';
}
export async function requestReminderPermission(): Promise<boolean> {
  return false;
}
export async function reconcileReminders(_planned: PlannedNudge[], _label: (iata: string) => string) {
  return { scheduled: 0, cancelled: 0 };
}
export async function cancelAllReminders() {}
export function onReminderOpened(_cb: (opened: ReminderOpened & { url: string }) => void): () => void {
  return () => {};
}
