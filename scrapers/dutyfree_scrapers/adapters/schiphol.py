"""Schiphol's online shop (See Buy Fly / Schiphol Airport Shopping).

NOTE: like the shopdutyfree adapter, the markup could not be inspected from
the build environment. JSON-LD is tried first and the category paths and CSS
selectors must be verified against the live site before enabling the schedule.
"""

from __future__ import annotations

from bs4 import BeautifulSoup

from ..models import ScrapedProduct
from ..normalize import detect_currency, parse_price, parse_volume_ml
from ._html import absolute, first_attr, first_text, rel_next, with_page_param
from .base import Adapter

LIQUOR_CATEGORIES = [
    "/en/at-schiphol/shop/liquor/whisky",
    "/en/at-schiphol/shop/liquor/vodka",
    "/en/at-schiphol/shop/liquor/gin",
    "/en/at-schiphol/shop/liquor/rum",
    "/en/at-schiphol/shop/liquor/cognac",
]


class SchipholAdapter(Adapter):
    slug = "schiphol"
    currency = "EUR"

    def category_urls(self) -> list[str]:
        return [self.base_url + path for path in LIQUOR_CATEGORIES]

    def parse_listing_html(self, soup: BeautifulSoup) -> list[ScrapedProduct]:
        products = []
        for card in soup.select("[data-testid='product-card'], .product-card, article.product"):
            name = first_text(card, ["[data-testid='product-title']", ".product-card__title", "h3", "h2"])
            price_text = first_text(card, ["[data-testid='product-price']", ".product-card__price", ".price"])
            price = parse_price(price_text)
            if not name or price is None:
                continue
            products.append(ScrapedProduct(
                name=name,
                brand=first_text(card, ["[data-testid='product-brand']", ".product-card__brand"]),
                price=price,
                currency=detect_currency(price_text, self.currency),
                url=absolute(self.base_url, first_attr(card, ["a[href]"], "href")),
                volume_ml=parse_volume_ml(name),
                image_url=first_attr(card, ["img"], "src"),
            ))
        return products

    def next_page_url(self, soup: BeautifulSoup, current_url: str, page: int) -> str | None:
        return rel_next(soup, self.base_url) or with_page_param(current_url, "page", page)
