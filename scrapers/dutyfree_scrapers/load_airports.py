"""Load airports with scheduled passenger service from OurAirports (public domain data).

Besides the IATA code, name and city, each row keeps the ICAO code and
OurAirports' `keywords` (other names and codes). Travellers search with any of
them: "Bangalore" for BLR, "Bombay" for BOM, "MLH" or "Basle" for Basel's BSL.

The app's bundle also carries each airport's IANA time zone (from the MIT
licensed `airportsdata` package), so the app can turn "09:40 at DXB on
20 Nov" into an exact instant for a travel-day reminder (ADR-0014).
"""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path

import httpx

OURAIRPORTS_CSV = "https://davidmegginson.github.io/ourairports-data/airports.csv"
TYPES = {"large_airport": "L", "medium_airport": "M"}


def parse(csv_text: str) -> list[dict]:
    rows = []
    for row in csv.DictReader(io.StringIO(csv_text)):
        iata = (row.get("iata_code") or "").strip().upper()
        if len(iata) != 3 or row.get("scheduled_service") != "yes":
            continue
        if row.get("type") not in TYPES:
            continue
        rows.append({
            "iata": iata,
            "icao": (row.get("icao_code") or row.get("gps_code") or "").strip().upper() or None,
            "name": row["name"],
            "city": row.get("municipality") or None,
            "country_code": row["iso_country"],
            "latitude": float(row["latitude_deg"]) if row.get("latitude_deg") else None,
            "longitude": float(row["longitude_deg"]) if row.get("longitude_deg") else None,
            "keywords": (row.get("keywords") or "").strip() or None,
            "size": TYPES[row["type"]],
        })
    # A handful of IATA codes appear twice; keep the first.
    return list({r["iata"]: r for r in reversed(rows)}.values())


def time_zones() -> "TimeZoneLookup":
    import airportsdata

    return TimeZoneLookup(airportsdata.load("IATA"), airportsdata.load("ICAO"))


class TimeZoneLookup:
    """IANA zone for an airport: by IATA, then ICAO, then the country's only zone.

    About 1% of OurAirports' scheduled airports are missing from airportsdata
    (mostly small Chinese and Pacific fields). If every known airport in that
    country shares one zone, that zone is right; otherwise we leave it blank
    and the app falls back to the phone's zone.
    """

    def __init__(self, by_iata: dict, by_icao: dict):
        self.by_iata, self.by_icao = by_iata, by_icao
        zones: dict[str, set[str]] = {}
        for a in by_iata.values():
            if a.get("tz") and a.get("country"):
                zones.setdefault(a["country"], set()).add(a["tz"])
        self.country_zone = {c: next(iter(z)) for c, z in zones.items() if len(z) == 1}

    def __call__(self, iata: str, icao: str | None, country: str) -> str:
        hit = self.by_iata.get(iata) or (self.by_icao.get(icao) if icao else None)
        if hit and hit.get("tz"):
            return hit["tz"]
        return self.country_zone.get(country, "")


def to_bundle(rows: list[dict], tz_for=None) -> list[list]:
    """Compact rows for the app's offline search (client/assets/airports.json).

    Column 10 is the IANA time zone ("" when unknown).
    """
    out = []
    for r in sorted(rows, key=lambda r: r["iata"]):
        out.append([
            r["iata"], r["icao"] or "", r["name"], r["city"] or "", r["country_code"],
            round(r["latitude"], 4) if r["latitude"] is not None else None,
            round(r["longitude"], 4) if r["longitude"] is not None else None,
            r["keywords"] or "", r["size"],
            tz_for(r["iata"], r["icao"], r["country_code"]) if tz_for else "",
        ])
    return out


def fetch_csv() -> str:
    resp = httpx.get(OURAIRPORTS_CSV, timeout=120, follow_redirects=True)
    resp.raise_for_status()
    return resp.text


def load() -> None:
    from .store import SupabaseStore

    rows = parse(fetch_csv())
    # `size` only drives ranking in the app's offline list.
    SupabaseStore().upsert_airports([{k: v for k, v in r.items() if k != "size"} for r in rows])
    print(f"loaded {len(rows)} airports")


def export_bundle(out: Path, csv_path: Path | None = None) -> int:
    text = csv_path.read_text(encoding="utf-8") if csv_path else fetch_csv()
    rows = to_bundle(parse(text), time_zones())
    out.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return len(rows)
