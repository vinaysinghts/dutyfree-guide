import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { Airport } from './types';

type TripState = {
  airports: Airport[];
  add: (airport: Airport) => void;
  remove: (iata: string) => void;
  move: (iata: string, delta: -1 | 1) => void;
  clear: () => void;
};

const TripContext = createContext<TripState | null>(null);
const STORAGE_KEY = 'trip.airports.v1';

/** The airports on the user's current trip, in travel order. Saved on device. */
export function TripProvider({ children }: { children: ReactNode }) {
  const [airports, setAirports] = useState<Airport[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => raw && setAirports(JSON.parse(raw)))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(airports)).catch(() => {});
  }, [airports, loaded]);

  const value = useMemo<TripState>(() => ({
    airports,
    add: (a) => setAirports((list) => (list.some((x) => x.iata === a.iata) ? list : [...list, a])),
    remove: (iata) => setAirports((list) => list.filter((x) => x.iata !== iata)),
    move: (iata, delta) =>
      setAirports((list) => {
        const i = list.findIndex((x) => x.iata === iata);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= list.length) return list;
        const next = [...list];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      }),
    clear: () => setAirports([]),
  }), [airports]);

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
}

export function useTrip() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error('useTrip must be used inside TripProvider');
  return ctx;
}
