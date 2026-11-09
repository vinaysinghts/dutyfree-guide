"""A polite HTTP client: honours robots.txt, identifies itself and rate-limits."""

from __future__ import annotations

import time
import urllib.robotparser
from urllib.parse import urljoin, urlparse

import httpx

USER_AGENT = "DutyFreeGuideBot/0.1 (+https://github.com/vinaysinghts/dutyfree-guide)"


class RobotsDisallowed(Exception):
    pass


class PoliteClient:
    def __init__(self, delay_seconds: float = 5.0, timeout: float = 30.0) -> None:
        self.delay = delay_seconds
        self._last_request = 0.0
        self._robots: dict[str, urllib.robotparser.RobotFileParser] = {}
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
                parser.parse(resp.text.splitlines() if resp.status_code == 200 else [])
            except httpx.HTTPError:
                parser.parse([])
            crawl_delay = parser.crawl_delay(USER_AGENT)
            if crawl_delay:
                self.delay = max(self.delay, float(crawl_delay))
            self._robots[origin] = parser
        return self._robots[origin]

    def get(self, url: str) -> str:
        if not self._robots_for(url).can_fetch(USER_AGENT, url):
            raise RobotsDisallowed(url)
        wait = self._last_request + self.delay - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last_request = time.monotonic()
        resp = self._client.get(url)
        resp.raise_for_status()
        return resp.text

    def close(self) -> None:
        self._client.close()
