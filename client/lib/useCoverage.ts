import { useEffect, useMemo, useState } from 'react';

import { coverageAt } from './api';
import { describeTrip, type AirportCoverage, type CoverageNote } from './coverage';

/**
 * Coverage notes for the trip's airports, in trip order. Until the view answers (or if
 * it fails) it returns nothing rather than guessing, so a slow network never shows
 * "Traveller prices only" for an airport that does have a scraper.
 */
export function useCoverage(iatas: string[]): CoverageNote[] {
  const key = iatas.join(',');
  const [rows, setRows] = useState<AirportCoverage[] | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    coverageAt(key ? key.split(',') : [])
      .then((r) => live && setRows(r))
      .catch(() => live && setRows(null));
    return () => {
      live = false;
    };
  }, [key]);
  return useMemo(() => (rows ? describeTrip(key ? key.split(',') : [], rows, new Date()) : []), [rows, key]);
}
