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


def test_sitemap_summary_follows_product_sitemaps_and_lists_liquor_urls():
    from dutyfree_scrapers.probe import sitemap_summary

    pages = {
        "https://x/sitemap.xml": "<sitemapindex><sitemap><loc>https://x/sitemap-products.xml</loc></sitemap>"
                                 "<sitemap><loc>https://x/sitemap-blog.xml</loc></sitemap></sitemapindex>",
        "https://x/sitemap-products.xml": "<urlset><url><loc>https://x/en/liquor/whisky/jw-black-1l</loc></url>"
                                          "<url><loc>https://x/en/perfume/chanel-no5</loc></url></urlset>",
    }

    class Client:
        fetched = []

        def get(self, url):
            self.fetched.append(url)
            return pages[url]

    out = sitemap_summary(Client(), "https://x/sitemap.xml")
    assert out["children"] == ["https://x/sitemap-products.xml", "https://x/sitemap-blog.xml"]
    assert out["liquor_urls"] == ["https://x/en/liquor/whisky/jw-black-1l"]
    # The blog sitemap is never fetched: only product/category ones, to keep traffic small.
    assert "https://x/sitemap-blog.xml" not in Client.fetched


def test_diagnose_spots_a_javascript_app_shell():
    from dutyfree_scrapers.probe import diagnose

    d = diagnose('<html><body><div id="root"></div><script src="/static/main.abc.js"></script></body></html>', "https://x")
    assert d["scripts"] == ["/static/main.abc.js"] and d["app_roots"] == ["div#root"]
