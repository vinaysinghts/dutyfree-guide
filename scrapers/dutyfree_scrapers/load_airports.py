"""Load airports with scheduled passenger service from OurAirports (public domain data)."""

from __future__ import annotations

import csv
import io

import httpx

OURAIRPORTS_CSV = "https://davidmegginson.github.io/ourairports-data/airports.csv"


def parse(csv_text: str) -> list[dict]:
    rows = []
    for row in csv.DictReader(io.StringIO(csv_text)):
        iata = (row.get("iata_code") or "").strip().upper()
        if len(iata) != 3 or row.get("scheduled_service") != "yes":
            continue
        if row.get("type") not in {"large_airport", "medium_airport"}:
            continue
        rows.append({
            "iata": iata,
            "name": row["name"],
            "city": row.get("municipality") or None,
            "country_code": row["iso_country"],
            "latitude": float(row["latitude_deg"]) if row.get("latitude_deg") else None,
            "longitude": float(row["longitude_deg"]) if row.get("longitude_deg") else None,
        })
    # A handful of IATA codes appear twice; keep the first.
    return list({r["iata"]: r for r in reversed(rows)}.values())


def load() -> None:
    from .store import SupabaseStore

    resp = httpx.get(OURAIRPORTS_CSV, timeout=120, follow_redirects=True)
    resp.raise_for_status()
    rows = parse(resp.text)
    SupabaseStore().upsert_airports(rows)
    print(f"loaded {len(rows)} airports")
