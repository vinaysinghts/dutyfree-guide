"""Dubai Duty Free (dubaidutyfree.com), the retailer for DXB.

Status: UNVERIFIED. Neither the development sandbox nor a robots-respecting page
fetcher could load dubaidutyfree.com (problems log #19), so robots.txt, the terms
of use and the listing markup are all unread. This adapter follows the same
"resilient to unknown markup" pattern as the first adapters (problems log #4):

1. JSON-LD Product/ItemList first (the base class does this),
2. a list of candidate CSS selectors as a fallback,
3. the crawl stops as soon as a page yields nothing new.

The category paths below are guesses. The Scraper live check prints robots.txt and
every liquor link on the home page from GitHub's runners; replace the guesses with
those links before the retailer row is switched on (ADR-0016).

Prices are in AED. AED is pegged to USD, and not an ECB reference currency, so
fx.py derives its INR rate from USD (ADR-0016).
"""

from __future__ import annotations

from bs4 import BeautifulSoup

from ..models import ScrapedProduct
from ..normalize import detect_currency, parse_price, parse_volume_ml
from ._html import absolute, first_attr, first_text, rel_next
from .base import Adapter

# Guesses; kept short on purpose because every path is a real request to their shop.
LIQUOR_CATEGORIES = [
    "/liquor",
    "/liquor/whisky",
    "/liquor/spirits",
]

CARD_SELECTORS = [".product-item", ".product-tile", ".product-card", "[data-product-id]", "li.product"]
NAME_SELECTORS = [".product-name", ".product-title", ".product-item-name", ".name", "h3", "h2"]
PRICE_SELECTORS = ["[data-price-amount]", ".price .value", ".product-price", ".price", "[class*=price]"]


class DubaiDutyFreeAdapter(Adapter):
    slug = "dubaidutyfree"
    currency = "AED"

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
            link = first_attr(card, ["a[href]:not([href='#'])"], "href")
            products.append(ScrapedProduct(
                name=name,
                brand=first_text(card, [".product-brand", ".brand"]),
                price=price,
                # "AED 125" and "Dhs 125" both mean AED; a bare number is the shop's currency.
                currency=self.currency if amount else detect_currency(price_text, self.currency),
                url=absolute(self.base_url, link),
                volume_ml=parse_volume_ml(name) or parse_volume_ml(first_text(card, [".product-size", ".size", ".volume"])),
                image_url=first_attr(card, ["img[data-src]"], "data-src") or first_attr(card, ["img"], "src"),
            ))
        return products

    def next_page_url(self, soup: BeautifulSoup, current_url: str, page: int) -> str | None:
        # Only follow a pager the page actually shows. Guessing ?page=N cost BLR a wasted
        # request per category when the site ignored it (problems log #12).
        nxt = rel_next(soup, self.base_url)
        if nxt:
            return nxt
        link = soup.select_one(".pages-item-next a[href], a.next[href], .pagination a[rel=next][href]")
        return absolute(self.base_url, link.get("href")) if link else None
