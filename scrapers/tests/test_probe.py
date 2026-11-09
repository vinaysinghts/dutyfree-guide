from pathlib import Path

import httpx

from dutyfree_scrapers.adapters.schiphol import SchipholAdapter
from dutyfree_scrapers.fetch import RobotsDisallowed
from dutyfree_scrapers.probe import probe

FIXTURES = Path(__file__).parent / "fixtures"


class FakeClient:
    """First category parses, second is blocked by robots.txt, the rest return 403."""

    def __init__(self):
        self.calls = 0

    def get(self, url):
        self.calls += 1
        if self.calls == 1:
            return (FIXTURES / "schiphol_cards.html").read_text(encoding="utf-8")
        if self.calls == 2:
            raise RobotsDisallowed(url)
        resp = httpx.Response(403, text="<html>Access denied</html>", request=httpx.Request("GET", url))
        raise httpx.HTTPStatusError("403", request=resp.request, response=resp)


def test_probe_reports_each_outcome_and_saves_pages(tmp_path):
    report = probe(SchipholAdapter("https://www.schiphol.nl"), FakeClient(), tmp_path, home=False)
    assert report[0]["outcome"] == "ok" and report[0]["parsed_products"] > 0
    assert report[0]["sample"][0]["name"]
    assert report[1]["outcome"] == "robots.txt disallows"
    assert report[2]["outcome"] == "HTTP 403"
    # The OK page and the 403 body are both kept for debugging.
    assert len(list(tmp_path.glob("*.html"))) == len(report) - 1


def test_diagnose_lists_liquor_links_and_product_classes():
    from dutyfree_scrapers.probe import diagnose

    html = """<html><title>Shop</title><a href="/en/92/wines-spirits/whisky">Whisky</a>
    <a href="/en/beauty">Beauty</a><div class="product-tile x"></div><div class="product-tile"></div></html>"""
    d = diagnose(html, "https://x")
    assert d["liquor_links"] == [["/en/92/wines-spirits/whisky", "Whisky"]] or d["liquor_links"] == [("/en/92/wines-spirits/whisky", "Whisky")]
    assert d["product_classes"][0] == ("product-tile", 2)
