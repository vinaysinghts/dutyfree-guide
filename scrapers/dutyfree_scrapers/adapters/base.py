"""Adapter contract: one adapter per retailer platform."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from collections.abc import Iterator

from bs4 import BeautifulSoup

from ..fetch import PoliteClient, RobotsDisallowed
from ..jsonld import products_from_jsonld
from ..models import ScrapedProduct

log = logging.getLogger(__name__)


class Adapter(ABC):
    slug: str
    currency: str
    max_pages_per_category = 30

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    @abstractmethod
    def category_urls(self) -> list[str]:
        """Listing pages to crawl (liquor categories only)."""

    @abstractmethod
    def parse_listing_html(self, soup: BeautifulSoup) -> list[ScrapedProduct]:
        """Fallback parser for when a page has no JSON-LD product data."""

    @abstractmethod
    def next_page_url(self, soup: BeautifulSoup, current_url: str, page: int) -> str | None:
        """URL of the next listing page, or None when done."""

    def parse_listing(self, html: str) -> list[ScrapedProduct]:
        products = products_from_jsonld(html, self.currency, self.base_url)
        if products:
            return products
        return self.parse_listing_html(BeautifulSoup(html, "html.parser"))

    def crawl(self, client: PoliteClient) -> Iterator[ScrapedProduct]:
        seen: set[str] = set()
        for start_url in self.category_urls():
            url: str | None = start_url
            page = 1
            while url and page <= self.max_pages_per_category:
                try:
                    html = client.get(url)
                except RobotsDisallowed:
                    log.warning("robots.txt disallows %s; skipping", url)
                    break
                products = self.parse_listing(html)
                log.info("%s page %d: %d products", start_url, page, len(products))
                new = [p for p in products if p.key not in seen]
                if not new:
                    # Empty page, or the site ignored the page parameter.
                    break
                for product in new:
                    seen.add(product.key)
                    yield product
                page += 1
                url = self.next_page_url(BeautifulSoup(html, "html.parser"), url, page)
