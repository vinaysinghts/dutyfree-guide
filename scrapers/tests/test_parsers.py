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


def test_shopdutyfree_follows_magento_pager():
    adapter = ADAPTERS["shopdutyfree"]("https://bengaluru.shopdutyfree.com")
    from bs4 import BeautifulSoup
    html = '<ul class="pages-items"><li class="item pages-item-next">' \
        '<a class="action next" href="/en/92/wines-spirits/whisky?p=2">Next</a></li></ul>'
    url = adapter.next_page_url(BeautifulSoup(html, "html.parser"), adapter.category_urls()[0], 2)
    assert url == "https://bengaluru.shopdutyfree.com/en/92/wines-spirits/whisky?p=2"


def test_shopdutyfree_no_pager_means_one_page():
    # BLR lists a whole subcategory on one page; ?p=2 just repeats it.
    adapter = ADAPTERS["shopdutyfree"]("https://bengaluru.shopdutyfree.com")
    from bs4 import BeautifulSoup
    assert adapter.next_page_url(BeautifulSoup(read("shopdutyfree_magento.html"), "html.parser"),
                                 adapter.category_urls()[0], 2) is None


def test_crawl_dedupes_same_bottle_within_one_page():
    from dutyfree_scrapers.models import ScrapedProduct
    from dutyfree_scrapers.adapters.base import Adapter

    class OnePage(Adapter):
        slug = "x"
        currency = "INR"

        def category_urls(self):
            return ["https://x/a"]

        def parse_listing(self, html):
            mk = lambda n, p: ScrapedProduct(name=n, brand="Johnnie Walker", price=Decimal(p), currency="INR")
            return [mk("Black Label 1L", "3450"), mk("Black Label 1L", "3500"), mk("Red Label 1L", "1500")]

        def parse_listing_html(self, soup):
            return []

        def next_page_url(self, soup, current_url, page):
            return None

    class Client:
        def get(self, url):
            return "<html></html>"

    got = list(OnePage("https://x").crawl(Client()))
    assert [p.name for p in got] == ["Black Label 1L", "Red Label 1L"] and got[0].price == Decimal("3450")
