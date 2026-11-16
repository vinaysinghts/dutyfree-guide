"""Daily exchange rates to INR from the free Frankfurter API (ECB reference rates).

The ECB publishes about 30 reference currencies. Gulf currencies are not among them:
AED (DXB) and QAR (DOH) have no ECB rate, so asking Frankfurter for them returns nothing
useful (problems log #19). Both are pegged to the US dollar by their central banks, so we
derive them from the USD rate. That is exact for as long as the peg holds, and the pegs
have held since 1997 (AED) and 2001 (QAR).
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal

import httpx

log = logging.getLogger(__name__)

FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest"

# currency -> (anchor, units of currency per 1 anchor). Official central-bank pegs.
PEGGED: dict[str, tuple[str, Decimal]] = {
    "AED": ("USD", Decimal("3.6725")),  # UAE Central Bank, since 1997
    "QAR": ("USD", Decimal("3.64")),    # Qatar Central Bank, since 2001
}


def rates_to_inr(currencies: list[str], client: httpx.Client | None = None) -> tuple[date, dict[str, Decimal]]:
    """Return (as_of, {currency: INR per 1 unit}). INR itself is always 1.

    A currency the ECB doesn't publish and we can't derive is left out (and logged),
    rather than failing the run: prices in it keep the last stored rate.
    """
    wanted = {c.upper() for c in currencies} - {"INR"}
    pegged = {c: PEGGED[c] for c in wanted if c in PEGGED}
    # Ask the ECB for the anchors of pegged currencies, never for the pegged ones themselves.
    ask = sorted((wanted - pegged.keys()) | {anchor for anchor, _ in pegged.values()})
    rates: dict[str, Decimal] = {"INR": Decimal(1)}
    if not ask:
        return date.today(), rates
    own_client = client is None
    client = client or httpx.Client(timeout=30)
    try:
        resp = client.get(FRANKFURTER_URL, params={"base": "INR", "symbols": ",".join(ask)})
        resp.raise_for_status()
        data = resp.json()
    finally:
        if own_client:
            client.close()
    for code, per_inr in data["rates"].items():
        rates[code] = (Decimal(1) / Decimal(str(per_inr))).quantize(Decimal("0.000001"))
    for code, (anchor, per_anchor) in pegged.items():
        if anchor in rates:
            rates[code] = (rates[anchor] / per_anchor).quantize(Decimal("0.000001"))
    missing = wanted - rates.keys()
    if missing:
        log.warning("no INR rate for %s; those prices keep their last stored rate", ", ".join(sorted(missing)))
    return date.fromisoformat(data["date"]), rates
