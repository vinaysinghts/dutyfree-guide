from decimal import Decimal
from pathlib import Path

from dutyfree_scrapers.adapters import ADAPTERS
from dutyfree_scrapers.jsonld import products_from_jsonld

FIXTURES = Path(__file__).parent / "fixtures"


def read(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_jsonld_item_list():
    products = products_from_jsonld(read("jsonld_listing.html"), "INR", "https://bengaluru.shopdutyfree.com")
    by_name = {p.name: p for p in products}
    jw = by_name["Johnnie Walker Black Label 1L"]
    assert jw.price == Decimal("3450.00") and jw.currency == "INR" and jw.volume_ml == 1000
    assert jw.brand == "Johnnie Walker"
    assert jw.url == "https://bengaluru.shopdutyfree.com/en/johnnie-walker-black-label-1l"
    glen = by_name["Glenfiddich 12 Year Old Single Malt 70cl"]
    assert glen.price == Decimal("4100") and glen.volume_ml == 700


def test_shopdutyfree_card_fallback():
    adapter = ADAPTERS["shopdutyfree"]("https://bengaluru.shopdutyfree.com")
    products = adapter.parse_listing(read("shopdutyfree_cards.html"))
    assert [p.name for p in products] == ["Absolut Vodka 1L", "Torres Coronas 75cl"]
    absolut = products[0]
    assert absolut.price == Decimal("1650") and absolut.currency == "INR"
    assert absolut.url == "https://bengaluru.shopdutyfree.com/en/92/absolut-vodka-1l"
    assert products[1].volume_ml == 750


def test_schiphol_card_fallback_and_cross_airport_match():
    adapter = ADAPTERS["schiphol"]("https://www.schiphol.nl")
    [jw] = adapter.parse_listing(read("schiphol_cards.html"))
    assert jw.price == Decimal("32.99") and jw.currency == "EUR" and jw.volume_ml == 1000
    blr = products_from_jsonld(read("jsonld_listing.html"), "INR")
    assert jw.key in {p.key for p in blr}


def test_crawl_stops_when_pages_repeat():
    html = read("shopdutyfree_cards.html")

    class FakeClient:
        calls = 0

        def get(self, url):
            self.calls += 1
            return html

    adapter = ADAPTERS["shopdutyfree"]("https://bengaluru.shopdutyfree.com")
    adapter.category_urls = lambda: ["https://bengaluru.shopdutyfree.com/en/liquor/spirits/vodka"]
    client = FakeClient()
    assert len(list(adapter.crawl(client))) == 2
    assert client.calls == 2


def test_shopdutyfree_live_magento_card():
    adapter = ADAPTERS["shopdutyfree"]("https://bengaluru.shopdutyfree.com")
    p, mini = adapter.parse_listing(read("shopdutyfree_magento.html"))
    assert p.brand == "Johnnie Walker"
    assert p.name == "Gold Label Reserve Blended Scotch Whisky 1l"
    # The sale (finalPrice) price, not the crossed-out oldPrice.
    assert p.price == Decimal("5450") and p.currency == "INR" and p.volume_ml == 1000
    assert p.url.endswith("/johnnie-walker-gold-label-reserve-blended-scotch-whisky-1l")
    # Wishlist href="#" comes first in the card; the product link must win. Size from the URL.
    assert mini.url.endswith("-20cl") and mini.volume_ml == 200


def test_shopdutyfree_paginates_with_p():
    adapter = ADAPTERS["shopdutyfree"]("https://bengaluru.shopdutyfree.com")
    from bs4 import BeautifulSoup
    url = adapter.next_page_url(BeautifulSoup("<html></html>", "html.parser"), adapter.category_urls()[0], 2)
    assert "p=2" in url and "product_list_limit=100" in url
