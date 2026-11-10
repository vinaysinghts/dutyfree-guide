"""Writes scraped prices to Supabase through its REST API (PostgREST).

Uses the service role key, which bypasses row level security. Never ship that
key to the app; it lives only in the scraper's environment / CI secrets.
"""

from __future__ import annotations

import os
from datetime import date
from decimal import Decimal

import httpx

from .models import ScrapedProduct
from .normalize import is_multipack


class SupabaseStore:
    def __init__(self, url: str | None = None, service_key: str | None = None) -> None:
        url = url or os.environ["SUPABASE_URL"]
        key = service_key or os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        headers = {"apikey": key, "Content-Type": "application/json"}
        # Legacy service_role keys are JWTs and also go in Authorization. The newer
        # sb_secret_… keys are not JWTs and only belong in the apikey header.
        if key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {key}"
        self._client = httpx.Client(base_url=url.rstrip("/") + "/rest/v1", headers=headers, timeout=60)

    def _post(self, table: str, rows: list[dict], *, on_conflict: str | None = None, returning: bool = False) -> list[dict]:
        prefer = ["resolution=merge-duplicates"] if on_conflict else []
        prefer.append("return=representation" if returning else "return=minimal")
        params = {"on_conflict": on_conflict} if on_conflict else None
        resp = self._client.post(f"/{table}", json=rows, params=params, headers={"Prefer": ",".join(prefer)})
        if resp.is_error:
            # PostgREST puts the Postgres error (code, message, hint) in the body; without
            # it a 500 is undiagnosable from the CI log.
            raise httpx.HTTPStatusError(f"{resp.status_code} from {table}: {resp.text[:500]}", request=resp.request, response=resp)
        return resp.json() if returning else []

    def retailers(self) -> list[dict]:
        resp = self._client.get("/retailers", params={"select": "*", "active": "eq.true", "adapter": "not.is.null"})
        resp.raise_for_status()
        return resp.json()

    def save_prices(self, retailer_id: int, products: list[ScrapedProduct]) -> int:
        # Multipacks can't be compared bottle-for-bottle, so they aren't stored.
        products = [p for p in products if not is_multipack(p.name, p.url)]
        # One row per match_key: Postgres rejects an upsert batch that touches a row twice.
        products = list({p.key: p for p in reversed(products)}.values())[::-1]
        if not products:
            return 0
        rows = [{
            "match_key": p.key, "brand": p.brand, "name": p.name,
            "volume_ml": p.volume_ml, "category": p.category, "image_url": p.image_url,
        } for p in products]
        saved = []
        for i in range(0, len(rows), 500):
            saved += self._post("products", rows[i:i + 500], on_conflict="match_key", returning=True)
        ids = {row["match_key"]: row["id"] for row in saved}
        prices = [{
            "product_id": ids[p.key], "retailer_id": retailer_id, "price": str(p.price),
            "currency": p.currency, "source": "scraped", "product_url": p.url,
        } for p in products if p.key in ids]
        for i in range(0, len(prices), 500):
            self._post("prices", prices[i:i + 500])
        return len(prices)

    def save_fx(self, as_of: date, rates: dict[str, Decimal]) -> None:
        self._post("fx_rates", [
            {"currency": c, "rate_to_inr": str(r), "as_of": as_of.isoformat()} for c, r in rates.items()
        ], on_conflict="currency")

    def upsert_airports(self, rows: list[dict]) -> None:
        for i in range(0, len(rows), 1000):
            self._post("airports", rows[i:i + 1000], on_conflict="iata")
