"""Extract products from schema.org JSON-LD, which most e-commerce sites embed.

This is the first thing every adapter tries, because it is far more stable
than CSS class names.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from bs4 import BeautifulSoup

from .models import ScrapedProduct
from .normalize import detect_currency, parse_price, parse_volume_ml


def _walk(node: Any) -> Iterator[dict]:
    if isinstance(node, list):
        for item in node:
            yield from _walk(item)
    elif isinstance(node, dict):
        yield node
        for key in ("@graph", "itemListElement", "item", "mainEntity"):
            if key in node:
                yield from _walk(node[key])


def _types(node: dict) -> set[str]:
    t = node.get("@type", [])
    return set(t if isinstance(t, list) else [t])


def _first_offer(offers: Any) -> dict | None:
    if isinstance(offers, list):
        return offers[0] if offers else None
    if isinstance(offers, dict):
        if "Offer" in _types(offers) or "price" in offers:
            return offers
        if "AggregateOffer" in _types(offers):
            return {"price": offers.get("lowPrice"), "priceCurrency": offers.get("priceCurrency")}
    return None


def _text(value: Any) -> str | None:
    if isinstance(value, dict):
        value = value.get("name")
    if isinstance(value, list):
        value = value[0] if value else None
    return str(value).strip() if value else None


def products_from_jsonld(html: str, default_currency: str, base_url: str | None = None) -> list[ScrapedProduct]:
    soup = BeautifulSoup(html, "html.parser")
    results: dict[str, ScrapedProduct] = {}
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        for node in _walk(data):
            if "Product" not in _types(node):
                continue
            name = _text(node.get("name"))
            offer = _first_offer(node.get("offers"))
            if not name or not offer:
                continue
            price = parse_price(offer.get("price"))
            if price is None:
                continue
            currency = offer.get("priceCurrency") or detect_currency(str(offer.get("price")), default_currency)
            url = node.get("url") or offer.get("url")
            if url and base_url and url.startswith("/"):
                url = base_url.rstrip("/") + url
            volume = parse_volume_ml(name) or parse_volume_ml(_text(node.get("size")))
            product = ScrapedProduct(
                name=name,
                brand=_text(node.get("brand")),
                price=price,
                currency=currency,
                url=url,
                volume_ml=volume,
                image_url=_text(node.get("image")),
            )
            results[product.key] = product
    return list(results.values())
