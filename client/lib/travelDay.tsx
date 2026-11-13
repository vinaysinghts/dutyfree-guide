/**
 * Glue between the trip, the nudge policy (lib/nudge.ts) and the platform:
 * reminders (lib/notifications.ts), the phone's location, and storage.
 *
 * Everything here stays on the device. The trip dates, the reminder history and the
 * "you're at DXB" check never go to our server (ADR-0014 §4). Location is read only while
 * the app is open; there is no background location and no geofence (ADR-0014 §4).
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
  type ActiveNudge, type Here, type NudgeHistory, type NudgeStop,
} from './nudge';
import {
  cancelAllReminders, configureReminders, onReminderOpened, reconcileReminders, reminderPermission,
  remindersSupported, requestReminderPermission,
} from './notifications';
import { useTrip } from './trip';

const PREFS_KEY = 'nudge.prefs.v1';
const HISTORY_KEY = 'nudge.history.v1';
/** Re-check at most this often; short, because the moment that matters is "just walked in". */
const HERE_CHECK_EVERY_MS = 2 * 60 * 1000;

type Prefs = { remindersOn: boolean; locationAskDismissed?: boolean };
type Permission = 'granted' | 'denied' | 'undetermined';

type TravelDayState = {
  /** The card to show now, if any. */
  active: ActiveNudge | null;
  stops: NudgeStop[];
  remindersSupported: boolean;
  remindersOn: boolean;
  /** 'denied' means the OS setting is off; we can't ask again from inside the app. */
  permission: Permission;
  setRemindersOn: (on: boolean) => Promise<void>;
  /** While-in-use location, used to notice "you're at an airport" when the app opens. */
  locationPermission: Permission;
  /** Show the one-time "let us notice airports" ask? */
  showLocationAsk: boolean;
  allowLocation: () => Promise<void>;
  declineLocationAsk: () => void;
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
  const [here, setHere] = useState<Here | null>(null);
  const [permission, setPermission] = useState<Permission>('undetermined');
  const [locationPermission, setLocationPermission] = useState<Permission>('undetermined');
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

  // Is the phone at an airport, any airport? Checked each time the app opens or comes back
  // to the front, with while-in-use location only: never in the background (ADR-0014 §4).
  // We read the permission here but never prompt: the prompt comes from the explainer card.
  const checkHere = useCallback(async (force = false) => {
    if (!force && Date.now() - lastHereCheck.current < HERE_CHECK_EVERY_MS) return;
    lastHereCheck.current = Date.now();
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      setLocationPermission(perm.granted ? 'granted' : perm.canAskAgain ? 'undetermined' : 'denied');
      if (!perm.granted) return setHere(null);
      const last = Platform.OS === 'web' ? null : await Location.getLastKnownPositionAsync({ maxAge: HERE_CHECK_EVERY_MS });
      const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      // ~3,200 airports, one haversine each: well under a millisecond's worth of work per check.
      const hit = nearestAirport(pos.coords, allAirports());
      setHere(hit && hit.km <= AT_AIRPORT_KM ? { iata: hit.airport.iata, tz: airportTimeZone(hit.airport.iata) } : null);
    } catch {
      // Location is a bonus; the date-based card still works.
    }
  }, []);

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

  const allowLocation = useCallback(async () => {
    const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
    setPrefs((p) => ({ ...p, locationAskDismissed: true }));
    if (perm?.granted) await checkHere(true);
    else setLocationPermission(perm?.canAskAgain === false ? 'denied' : 'undetermined');
  }, [checkHere]);

  const value = useMemo<TravelDayState>(() => ({
    active: activeNudge(stops, history, now, here),
    stops,
    remindersSupported,
    remindersOn: prefs.remindersOn,
    permission,
    setRemindersOn,
    locationPermission,
    showLocationAsk: loaded && locationPermission === 'undetermined' && !prefs.locationAskDismissed,
    allowLocation,
    declineLocationAsk: () => setPrefs((p) => ({ ...p, locationAskDismissed: true })),
    dismiss: (iata, date) => setHistory((h) => recordDismissed(h, iata, date)),
    snapped: (iata) => setHistory((h) => recordSnap(h, iata, new Date())),
  }), [stops, history, now, here, loaded, prefs, permission, setRemindersOn, locationPermission, allowLocation]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTravelDay() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTravelDay must be used inside TravelDayProvider');
  return ctx;
}
