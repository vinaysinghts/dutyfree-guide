"""A polite HTTP client: honours robots.txt, identifies itself and rate-limits."""

from __future__ import annotations

import html
import time
import urllib.robotparser
from urllib.parse import urljoin, urlparse

import httpx

USER_AGENT = "DutyFreeGuideBot/0.1 (+https://github.com/vinaysinghts/dutyfree-guide)"


class RobotsDisallowed(Exception):
    pass


class SiteBlocked(Exception):
    """The site refused us before any robots.txt rule applied (a bot wall or IP block).

    Different from RobotsDisallowed: robots.txt *rules* tell us what not to crawl, while
    a 401/403 on robots.txt itself means the site's edge is turning us away. We stop and
    don't try to get around it (ADR-0011).
    """

    def __init__(self, origin: str, status: int, detail: str) -> None:
        super().__init__(f"{origin} refused us with HTTP {status} ({detail})")
        self.origin = origin
        self.status = status
        self.detail = detail


def describe_block(resp: httpx.Response) -> str:
    """Name the bot wall from its fingerprints, so a log line says who blocked us."""
    h = {k.lower(): v for k, v in resp.headers.items()}
    body = html.unescape(resp.text[:2000])  # Akamai entity-encodes its error page
    if "cf-mitigated" in h or "cf-ray" in h or "cloudflare" in h.get("server", "").lower():
        return "Cloudflare" + (f" {h['cf-mitigated']}" if "cf-mitigated" in h else "")
    if "akamai" in h.get("server", "").lower() or "edgesuite.net" in body or "akamai-grn" in h:
        return "Akamai edge 'Access Denied'"
    if "x-datadome" in h or "datadome" in body.lower():
        return "DataDome"
    return f"server {h.get('server', 'unknown')}"


class PoliteClient:
    def __init__(self, delay_seconds: float = 5.0, timeout: float = 30.0) -> None:
        self.delay = delay_seconds
        self._last_request = 0.0
        self.last_url: str | None = None
        self._robots: dict[str, urllib.robotparser.RobotFileParser] = {}
        self._blocked: dict[str, SiteBlocked] = {}
        self._client = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
            timeout=timeout,
            follow_redirects=True,
        )

    def _robots_for(self, url: str) -> urllib.robotparser.RobotFileParser:
        origin = "{0.scheme}://{0.netloc}".format(urlparse(url))
        if origin not in self._robots:
            parser = urllib.robotparser.RobotFileParser()
            try:
                resp = self._client.get(urljoin(origin, "/robots.txt"))
                if resp.status_code in (401, 403):
                    # RFC 9309 says a 4xx robots.txt means "no rules, crawl freely". But a
                    # 401/403 here is the site's edge refusing *us*, not a missing file, so
                    # we crawl nothing and say so (ADR-0011).
                    parser.disallow_all = True
                    self._blocked[origin] = SiteBlocked(origin, resp.status_code, describe_block(resp))
                else:
                    parser.parse(resp.text.splitlines() if resp.status_code == 200 else [])
            except httpx.HTTPError:
                parser.parse([])
            crawl_delay = parser.crawl_delay(USER_AGENT)
            if crawl_delay:
                self.delay = max(self.delay, float(crawl_delay))
            self._robots[origin] = parser
        return self._robots[origin]

    def get(self, url: str) -> str:
        parser = self._robots_for(url)
        origin = "{0.scheme}://{0.netloc}".format(urlparse(url))
        if origin in self._blocked:
            raise self._blocked[origin]
        if not parser.can_fetch(USER_AGENT, url):
            raise RobotsDisallowed(url)
        wait = self._last_request + self.delay - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last_request = time.monotonic()
        resp = self._client.get(url)
        self.last_url = str(resp.url)  # after redirects
        if resp.status_code in (401, 403, 429):
            # Blocked mid-crawl: remember it so we stop asking this site for the rest of the run.
            self._blocked[origin] = SiteBlocked(origin, resp.status_code, describe_block(resp))
            raise self._blocked[origin]
        resp.raise_for_status()
        return resp.text

    def close(self) -> None:
        self._client.close()
