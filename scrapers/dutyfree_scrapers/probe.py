"""Check an adapter against the live site without touching the database.

For each category URL: fetch it (robots.txt honoured, same polite delay as a
real run), save the HTML, and report the HTTP outcome, page title, how many
JSON-LD products and how many parsed products it found. This is what tells us
whether "0 products" means a blocked request, a JavaScript-only page, a wrong
URL or a wrong CSS selector.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from .fetch import PoliteClient, RobotsDisallowed, SiteBlocked
from .jsonld import products_from_jsonld


# Terms, legal and API-access pages: a person has to read these before an adapter is
# switched on (ADR-0004), and the probe is often the only thing that can reach the site.
POLICY_LINK_RE = re.compile(r"terms|conditions|legal|privacy|policy|disclaimer|api|developer|affiliate|partner", re.I)
LIQUOR_LINK_RE = re.compile(r"whisk|spirit|liquor|liqueur|wine|vodka|gin\b|rum\b|cognac|brandy|tequila|champagne", re.I)
CARD_PROBES = ["li.product-item", ".product-item", "[data-product-id]", ".product-item-info", ".product-tile", ".product-card"]
APP_STATE_MARKERS = ["__NEXT_DATA__", "__NUXT__", "window.__INITIAL_STATE__", "application/ld+json", "data-product", "ng-version"]


def diagnose(html: str, base_url: str) -> dict:
    """What a page is made of, so selectors and category URLs can be fixed from the log alone."""
    soup = BeautifulSoup(html, "html.parser")
    classes = Counter(c for tag in soup.find_all(class_=True) for c in tag.get("class", []) if "product" in c.lower())
    links = {}
    policy = {}
    for a in soup.find_all("a", href=True):
        text = a.get_text(" ", strip=True)[:60]
        href = a["href"]
        if LIQUOR_LINK_RE.search(href) or LIQUOR_LINK_RE.search(text):
            links.setdefault(href, text)
        if POLICY_LINK_RE.search(href) or POLICY_LINK_RE.search(text):
            policy.setdefault(href, text)
    card_counts = {sel: len(soup.select(sel)) for sel in CARD_PROBES}
    first_card = next((soup.select_one(sel) for sel in CARD_PROBES if soup.select_one(sel)), None)
    pager = soup.select_one(".pages, .pagination, .toolbar-products, nav[aria-label*=agination]")
    return {
        "card_counts": card_counts,
        # One real card's markup is what the CSS fallback has to be written against.
        "first_card_html": re.sub(r"\s+", " ", str(first_card))[:3000] if first_card else None,
        "first_price_html": re.sub(r"\s+", " ", str(first_card.select_one(".price-box")))[:2500] if first_card and first_card.select_one(".price-box") else None,
        "pager_html": re.sub(r"\s+", " ", str(pager))[:1200] if pager else None,
        "rel_next": (soup.find("link", rel="next") or {}).get("href") if soup.find("link", rel="next") else None,
        "jsonld_types": sorted({m for m in re.findall(r'"@type"\s*:\s*"(\w+)"', html)})[:20],
        "title": soup.title.get_text(strip=True)[:120] if soup.title else None,
        "bytes": len(html),
        "markers": [m for m in APP_STATE_MARKERS if m in html],
        "product_classes": classes.most_common(12),
        "liquor_links": list(links.items())[:40],
        "policy_links": list(policy.items())[:15],
        "text_start": soup.get_text(" ", strip=True)[:300],
    }


def probe(adapter, client: PoliteClient, save_dir: Path, sample: int = 3, home: bool = True) -> list[dict]:
    save_dir.mkdir(parents=True, exist_ok=True)
    report = []
    if home:
        try:
            robots = client._client.get(adapter.base_url + "/robots.txt")
            print(json.dumps({"robots_url": str(robots.url), "status": robots.status_code,
                              "crawl_delay_s": client.delay, "robots_txt": robots.text[:1500]}), flush=True)
        except httpx.HTTPError:
            pass
        # The home page shows the site's real category URLs when ours are wrong.
        row = {"url": adapter.base_url, "home": True}
        try:
            html = client.get(adapter.base_url)
            row.update(outcome="ok", **diagnose(html, adapter.base_url))
            _save(save_dir, adapter.base_url + "/home", html)
        except Exception as e:  # diagnostics only
            row.update(_error_details(e))
        print(json.dumps(row, ensure_ascii=False), flush=True)
    for url in adapter.category_urls():
        row: dict = {"url": url}
        try:
            html = client.get(url)
        except RobotsDisallowed:
            row["outcome"] = "robots.txt disallows"
        except SiteBlocked as e:
            row["outcome"] = f"blocked: {e}"
        except httpx.HTTPStatusError as e:
            row.update(_error_details(e))
            _save(save_dir, url, e.response.text)
        except httpx.HTTPError as e:
            row["outcome"] = f"network error: {type(e).__name__}: {e}"
        else:
            row["outcome"] = "ok"
            _save(save_dir, url, html)
            row["final_url"] = getattr(client, "last_url", None)
            row["jsonld_products"] = len(products_from_jsonld(html, adapter.currency, adapter.base_url))
            products = adapter.parse_listing(html)
            row["parsed_products"] = len(products)
            row["sample"] = [p.as_json() for p in products[:sample]]
            if not products:
                d = diagnose(html, adapter.base_url)
                d.pop("liquor_links", None)
                d.pop("policy_links", None)
                row.update(d)
        report.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
    return report


def _error_details(e: Exception) -> dict:
    if isinstance(e, SiteBlocked):
        return {"outcome": f"blocked: {e}"}
    if isinstance(e, RobotsDisallowed):
        return {"outcome": "robots.txt disallows"}
    if isinstance(e, httpx.HTTPStatusError):
        r = e.response
        soup = BeautifulSoup(r.text, "html.parser")
        return {
            "outcome": f"HTTP {r.status_code}",
            # Bot walls identify themselves in headers (cf-ray = Cloudflare, akamai-grn = Akamai).
            "headers": {k: v for k, v in r.headers.items() if k.lower() in {"server", "cf-ray", "cf-mitigated", "akamai-grn", "x-cache", "x-datadome", "set-cookie"}},
            "title": soup.title.get_text(strip=True)[:120] if soup.title else None,
            "text_start": soup.get_text(" ", strip=True)[:300],
        }
    return {"outcome": f"network error: {type(e).__name__}: {e}"}


def _save(save_dir: Path, url: str, html: str) -> None:
    u = urlparse(url)
    name = re.sub(r"[^a-z0-9]+", "_", (u.netloc + u.path).lower()).strip("_")
    (save_dir / f"{name}.html").write_text(html, encoding="utf-8")
