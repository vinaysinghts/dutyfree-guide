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
from pathlib import Path
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from .fetch import PoliteClient, RobotsDisallowed
from .jsonld import products_from_jsonld


def probe(adapter, client: PoliteClient, save_dir: Path, sample: int = 3) -> list[dict]:
    save_dir.mkdir(parents=True, exist_ok=True)
    report = []
    for url in adapter.category_urls():
        row: dict = {"url": url}
        try:
            html = client.get(url)
        except RobotsDisallowed:
            row["outcome"] = "robots.txt disallows"
        except httpx.HTTPStatusError as e:
            row["outcome"] = f"HTTP {e.response.status_code}"
            html = e.response.text
            _save(save_dir, url, html)
        except httpx.HTTPError as e:
            row["outcome"] = f"network error: {type(e).__name__}: {e}"
        else:
            row["outcome"] = "ok"
            _save(save_dir, url, html)
            soup = BeautifulSoup(html, "html.parser")
            row["title"] = soup.title.get_text(strip=True)[:120] if soup.title else None
            row["bytes"] = len(html)
            row["scripts"] = len(soup.find_all("script"))
            row["jsonld_products"] = len(products_from_jsonld(html, adapter.currency, adapter.base_url))
            products = adapter.parse_listing(html)
            row["parsed_products"] = len(products)
            row["sample"] = [p.as_json() for p in products[:sample]]
        report.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
    return report


def _save(save_dir: Path, url: str, html: str) -> None:
    u = urlparse(url)
    name = re.sub(r"[^a-z0-9]+", "_", (u.netloc + u.path).lower()).strip("_")
    (save_dir / f"{name}.html").write_text(html, encoding="utf-8")
