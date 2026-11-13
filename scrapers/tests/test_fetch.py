import httpx
import pytest

from dutyfree_scrapers.fetch import PoliteClient, RobotsDisallowed, SiteBlocked


def client_with(robots_status: int, robots_body: str = "") -> PoliteClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(robots_status, text=robots_body)
        return httpx.Response(200, text="<html>ok</html>")

    c = PoliteClient(delay_seconds=0)
    c._client = httpx.Client(transport=httpx.MockTransport(handler))
    return c


AKAMAI_DENIED = (
    "<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY><H1>Access Denied</H1>"
    "Reference&#32;&#35;18&#46;6b0f3417 <P>https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;18</P>"
    "</BODY></HTML>"
)


def test_robots_403_is_a_block_not_a_rule():
    # The real BLR response from GitHub's runners, 2026-11-10/11 (problems log #13).
    with pytest.raises(SiteBlocked) as e:
        client_with(403, AKAMAI_DENIED).get("https://shop.example/en/liquor")
    assert e.value.status == 403 and "Akamai" in e.value.detail


def test_blocked_mid_crawl_stops_asking_that_site():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\n")
        return httpx.Response(403, headers={"cf-mitigated": "challenge"}, text="Just a moment...")

    c = PoliteClient(delay_seconds=0)
    c._client = httpx.Client(transport=httpx.MockTransport(handler))
    for path in ("/a", "/b"):
        with pytest.raises(SiteBlocked, match="Cloudflare challenge"):
            c.get("https://shop.example" + path)
    assert calls == ["/robots.txt", "/a"]  # /b never sent


def test_robots_404_means_allow():
    assert client_with(404).get("https://shop.example/en/liquor") == "<html>ok</html>"


def test_robots_rules_are_honoured():
    c = client_with(200, "User-agent: *\nDisallow: /private\n")
    assert c.get("https://shop.example/en/liquor") == "<html>ok</html>"
    with pytest.raises(RobotsDisallowed):
        c.get("https://shop.example/private/x")
