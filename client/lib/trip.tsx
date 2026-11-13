import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { Airport } from './types';
import type { LocalDate, LocalTime } from './zonedTime';

/** When the traveller is at one trip airport. Optional; only travel-day reminders use it. */
export type StopPlan = { date?: LocalDate; time?: LocalTime };

type TripState = {
  airports: Airport[];
  /** Keyed by IATA code. Kept apart from `airports` so older saved trips load unchanged. */
  plans: Record<string, StopPlan>;
  setPlan: (iata: string, plan: StopPlan) => void;
  add: (airport: Airport) => void;
  remove: (iata: string) => void;
  move: (iata: string, delta: -1 | 1) => void;
  clear: () => void;
};

const TripContext = createContext<TripState | null>(null);
const STORAGE_KEY = 'trip.airports.v1';
const PLANS_KEY = 'trip.plans.v1';

/** The airports on the user's current trip, in travel order. Saved on device. */
export function TripProvider({ children }: { children: ReactNode }) {
  const [airports, setAirports] = useState<Airport[]>([]);
  const [plans, setPlans] = useState<Record<string, StopPlan>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY).then((raw) => raw && setAirports(JSON.parse(raw))),
      AsyncStorage.getItem(PLANS_KEY).then((raw) => raw && setPlans(JSON.parse(raw))),
    ])
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(airports)).catch(() => {});
  }, [airports, loaded]);

  useEffect(() => {
    if (loaded) AsyncStorage.setItem(PLANS_KEY, JSON.stringify(plans)).catch(() => {});
  }, [plans, loaded]);

  const value = useMemo<TripState>(() => ({
    airports,
    plans,
    setPlan: (iata, plan) =>
      setPlans((all) => {
        const next = { ...all };
        if (plan.date || plan.time) next[iata] = plan;
        else delete next[iata];
        return next;
      }),
    add: (a) => setAirports((list) => (list.some((x) => x.iata === a.iata) ? list : [...list, a])),
    remove: (iata) => {
      setAirports((list) => list.filter((x) => x.iata !== iata));
      setPlans(({ [iata]: _gone, ...rest }) => rest);
    },
    move: (iata, delta) =>
      setAirports((list) => {
        const i = list.findIndex((x) => x.iata === iata);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= list.length) return list;
        const next = [...list];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      }),
    clear: () => {
      setAirports([]);
      setPlans({});
    },
  }), [airports, plans]);

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
}

export function useTrip() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error('useTrip must be used inside TripProvider');
  return ctx;
}
