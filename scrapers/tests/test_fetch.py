import httpx
import pytest

from dutyfree_scrapers.fetch import PoliteClient, RobotsDisallowed


def client_with(robots_status: int, robots_body: str = "") -> PoliteClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return httpx.Response(robots_status, text=robots_body)
        return httpx.Response(200, text="<html>ok</html>")

    c = PoliteClient(delay_seconds=0)
    c._client = httpx.Client(transport=httpx.MockTransport(handler))
    return c


def test_robots_403_means_disallow_all():
    with pytest.raises(RobotsDisallowed):
        client_with(403, "Access Denied").get("https://shop.example/en/liquor")


def test_robots_404_means_allow():
    assert client_with(404).get("https://shop.example/en/liquor") == "<html>ok</html>"


def test_robots_rules_are_honoured():
    c = client_with(200, "User-agent: *\nDisallow: /private\n")
    assert c.get("https://shop.example/en/liquor") == "<html>ok</html>"
    with pytest.raises(RobotsDisallowed):
        c.get("https://shop.example/private/x")
