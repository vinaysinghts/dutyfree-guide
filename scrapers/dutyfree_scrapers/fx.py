"""Daily exchange rates to INR from the free Frankfurter API (ECB reference rates)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import httpx

FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest"


def rates_to_inr(currencies: list[str], client: httpx.Client | None = None) -> tuple[date, dict[str, Decimal]]:
    """Return (as_of, {currency: INR per 1 unit}). INR itself is always 1."""
    wanted = sorted({c.upper() for c in currencies} - {"INR"})
    rates: dict[str, Decimal] = {"INR": Decimal(1)}
    if not wanted:
        return date.today(), rates
    own_client = client is None
    client = client or httpx.Client(timeout=30)
    try:
        resp = client.get(FRANKFURTER_URL, params={"base": "INR", "symbols": ",".join(wanted)})
        resp.raise_for_status()
        data = resp.json()
    finally:
        if own_client:
            client.close()
    for code, per_inr in data["rates"].items():
        rates[code] = (Decimal(1) / Decimal(str(per_inr))).quantize(Decimal("0.000001"))
    return date.fromisoformat(data["date"]), rates
