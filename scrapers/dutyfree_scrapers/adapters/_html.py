"""Helpers for CSS-selector fallbacks."""

from __future__ import annotations

from urllib.parse import parse_qs, urlencode, urljoin, urlparse, urlunparse

from bs4 import BeautifulSoup, Tag


def first_text(node: Tag, selectors: list[str]) -> str | None:
    for selector in selectors:
        found = node.select_one(selector)
        if found and found.get_text(strip=True):
            return found.get_text(" ", strip=True)
    return None


def first_attr(node: Tag, selectors: list[str], attr: str) -> str | None:
    for selector in selectors:
        found = node.select_one(selector)
        if found and found.get(attr):
            return str(found.get(attr))
    return None


def absolute(base_url: str, href: str | None) -> str | None:
    return urljoin(base_url + "/", href) if href else None


def with_page_param(url: str, param: str, page: int) -> str:
    parts = urlparse(url)
    query = parse_qs(parts.query)
    query[param] = [str(page)]
    return urlunparse(parts._replace(query=urlencode(query, doseq=True)))


def rel_next(soup: BeautifulSoup, base_url: str) -> str | None:
    link = soup.select_one('link[rel="next"], a[rel="next"]')
    return absolute(base_url, link.get("href")) if link else None
