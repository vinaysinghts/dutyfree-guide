"""Avolta (Dufry/Nuance) shopdutyfree.com stores, e.g. bengaluru.shopdutyfree.com.

The same platform runs many airports, so this adapter can be reused by adding
another retailer row with a different base_url.

NOTE: the listing markup could not be inspected from the build environment.
JSON-LD is tried first; the CSS fallback selectors below are best guesses and
must be checked against the live site before the first scheduled run.
"""

from __future__ import annotations

from bs4 import BeautifulSoup

from ..models import ScrapedProduct
from ..normalize import detect_currency, parse_price, parse_volume_ml
from ._html import absolute, first_attr, first_text, rel_next, with_page_param
from .base import Adapter

# Real paths from the live BLR home page (Scraper live check, 2026-11-09). The
# "92" segment is the store id; "view-all-liquor" covers every spirits and wine
# subcategory, so one listing is enough.
LIQUOR_CATEGORIES = [
    # 100 per page (the largest the site offers) means fewer requests at the 30 s crawl delay.
    "/en/92/wines-spirits/view-all-liquor?product_list_limit=100",
]

# Magento markup, checked against the live BLR listing (Scraper live check, 2026-11-09):
#   li.product-item > .product-brand, .product-item-name a, .price-box [data-price-amount]
# Note [data-product-id] sits on the price box, not the card, so it can't be a card selector.
CARD_SELECTORS = ["li.product-item", ".product-item", ".product-tile", ".product-card"]
NAME_SELECTORS = [".product-item-name", ".product-name", ".product-title", "h2", "h3"]
PRICE_SELECTORS = ['[data-price-type="finalPrice"][data-price-amount]', "[data-price-amount]", ".price .value", ".price", ".product-price"]


class ShopDutyFreeAdapter(Adapter):
    slug = "shopdutyfree"
    currency = "INR"

    def __init__(self, base_url: str, currency: str = "INR") -> None:
        super().__init__(base_url)
        self.currency = currency

    def category_urls(self) -> list[str]:
        return [self.base_url + path for path in LIQUOR_CATEGORIES]

    def parse_listing_html(self, soup: BeautifulSoup) -> list[ScrapedProduct]:
        cards = []
        for selector in CARD_SELECTORS:
            cards = soup.select(selector)
            if cards:
                break
        products = []
        for card in cards:
            name = first_text(card, NAME_SELECTORS)
            amount = first_attr(card, PRICE_SELECTORS, "data-price-amount")
            price_text = amount or first_text(card, PRICE_SELECTORS)
            price = parse_price(price_text)
            if not name or price is None:
                continue
            products.append(ScrapedProduct(
                name=name,
                brand=first_text(card, [".product-brand", ".brand"]),
                price=price,
                currency=detect_currency(price_text, self.currency) if not amount else self.currency,
                url=absolute(self.base_url, first_attr(card, ["a[href]"], "href")),
                volume_ml=parse_volume_ml(name) or parse_volume_ml(first_text(card, [".product-size", ".size"])),
                image_url=first_attr(card, ["img[data-src]"], "data-src") or first_attr(card, ["img"], "src"),
            ))
        return products

    def next_page_url(self, soup: BeautifulSoup, current_url: str, page: int) -> str | None:
        # Magento pages with ?p=N.
        return rel_next(soup, self.base_url) or with_page_param(current_url, "p", page)
