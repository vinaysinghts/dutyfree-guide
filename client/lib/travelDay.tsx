/**
 * Glue between the trip, the nudge policy (lib/nudge.ts) and the platform:
 * reminders (lib/notifications.ts), the phone's location, and storage.
 *
 * Everything here stays on the device. The trip dates, the reminder history and the
 * "you're at DXB" check never go to our server (ADR-0014 §4).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { airportTimeZone, allAirports } from './airports';
import { AT_AIRPORT_KM, nearestAirport } from './geo';
import {
  EMPTY_HISTORY, activeNudge, planNudges, recordDismissed, recordOpened, recordScheduled, recordSnap, settle,
  type ActiveNudge, type NudgeHistory, type NudgeStop,
} from './nudge';
import {
  cancelAllReminders, configureReminders, onReminderOpened, reconcileReminders, reminderPermission,
  remindersSupported, requestReminderPermission,
} from './notifications';
import { useTrip } from './trip';

const PREFS_KEY = 'nudge.prefs.v1';
const HISTORY_KEY = 'nudge.history.v1';
const HERE_CHECK_EVERY_MS = 10 * 60 * 1000;

type Prefs = { remindersOn: boolean };

type TravelDayState = {
  /** The card to show now, if any. */
  active: ActiveNudge | null;
  stops: NudgeStop[];
  remindersSupported: boolean;
  remindersOn: boolean;
  /** 'denied' means the OS setting is off; we can't ask again from inside the app. */
  permission: 'granted' | 'denied' | 'undetermined';
  setRemindersOn: (on: boolean) => Promise<void>;
  dismiss: (iata: string, date: string) => void;
  /** Call after a price report is sent, so we don't ask at that airport again soon. */
  snapped: (iata: string) => void;
};

const Ctx = createContext<TravelDayState | null>(null);

export function TravelDayProvider({ children }: { children: ReactNode }) {
  const trip = useTrip();
  const [prefs, setPrefs] = useState<Prefs>({ remindersOn: false });
  const [history, setHistory] = useState<NudgeHistory>(EMPTY_HISTORY);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [hereIata, setHereIata] = useState<string | null>(null);
  const [permission, setPermission] = useState<TravelDayState['permission']>('undetermined');
  const lastHereCheck = useRef(0);

  const stops = useMemo<NudgeStop[]>(
    () => trip.airports.map((a) => ({ iata: a.iata, tz: airportTimeZone(a.iata), ...trip.plans[a.iata] })),
    [trip.airports, trip.plans],
  );

  useEffect(() => {
    configureReminders();
    Promise.all([
      AsyncStorage.getItem(PREFS_KEY).then((raw) => raw && setPrefs(JSON.parse(raw))),
      AsyncStorage.getItem(HISTORY_KEY).then((raw) => raw && setHistory({ ...EMPTY_HISTORY, ...JSON.parse(raw) })),
      reminderPermission().then(setPermission),
    ])
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded) AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => {});
  }, [prefs, loaded]);
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history)).catch(() => {});
  }, [history, loaded]);

  // Is the phone at one of the trip's airports? Only if location was already allowed
  // (for snapping a tag): we never ask for location just to show this card.
  const checkHere = useCallback(async () => {
    if (Platform.OS === 'web' || stops.length === 0) return;
    if (Date.now() - lastHereCheck.current < HERE_CHECK_EVERY_MS) return;
    lastHereCheck.current = Date.now();
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) return;
      const pos =
        (await Location.getLastKnownPositionAsync({ maxAge: HERE_CHECK_EVERY_MS })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
      const tripIatas = new Set(stops.map((s) => s.iata));
      const hit = nearestAirport(pos.coords, allAirports().filter((a) => tripIatas.has(a.iata)));
      setHereIata(hit && hit.km <= AT_AIRPORT_KM ? hit.airport.iata : null);
    } catch {
      // Location is a bonus; the date-based card still works.
    }
  }, [stops]);

  // Tick the clock and re-check on foreground: cards open and close with time.
  useEffect(() => {
    const tick = () => {
      setNow(new Date());
      checkHere();
      reminderPermission().then(setPermission).catch(() => {});
    };
    tick();
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && tick());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [checkHere]);

  // Reconcile scheduled reminders with the plan whenever the trip, history or switch changes.
  const historyRef = useRef(history);
  historyRef.current = history;
  useEffect(() => {
    if (!loaded || !remindersSupported) return;
    const at = new Date();
    const settled = settle(historyRef.current, at);
    const planned = planNudges(stops, settled, at, prefs.remindersOn && permission === 'granted');
    const label = (iata: string) => {
      const a = trip.airports.find((x) => x.iata === iata);
      return a?.city ? `${a.city} (${iata})` : iata;
    };
    reconcileReminders(planned, label)
      .then(() => setHistory(recordScheduled(settled, planned, at)))
      .catch(() => {});
    // Depending on all of `history` would loop (each reconcile writes it), so we watch
    // only the parts the traveller changes: reports and closed cards.
  }, [loaded, stops, prefs.remindersOn, permission, now.getHours(), history.snaps.length, history.dismissed.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A tapped reminder opens the camera for that airport.
  useEffect(
    () =>
      onReminderOpened(({ id, url }) => {
        setHistory((h) => recordOpened(h, id));
        // Give the router a moment on a cold start before navigating.
        setTimeout(() => router.push(url as never), 0);
      }),
    [],
  );

  const setRemindersOn = useCallback(async (on: boolean) => {
    if (on && (await reminderPermission()) !== 'granted') {
      const granted = await requestReminderPermission();
      setPermission(granted ? 'granted' : await reminderPermission());
      if (!granted) return;
    }
    if (!on) await cancelAllReminders().catch(() => {});
    setPrefs((p) => ({ ...p, remindersOn: on }));
  }, []);

  const value = useMemo<TravelDayState>(() => ({
    active: activeNudge(stops, history, now, hereIata),
    stops,
    remindersSupported,
    remindersOn: prefs.remindersOn,
    permission,
    setRemindersOn,
    dismiss: (iata, date) => setHistory((h) => recordDismissed(h, iata, date)),
    snapped: (iata) => setHistory((h) => recordSnap(h, iata, new Date())),
  }), [stops, history, now, hereIata, prefs.remindersOn, permission, setRemindersOn]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTravelDay() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTravelDay must be used inside TravelDayProvider');
  return ctx;
}
