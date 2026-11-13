import logging
from datetime import date

from dutyfree_scrapers import cli, store
from dutyfree_scrapers.fetch import SiteBlocked


class FakeStore:
    saved: list = []

    def retailers(self):
        return [{"id": 1, "name": "BLR Duty Free", "adapter": "shopdutyfree",
                 "base_url": "https://bengaluru.shopdutyfree.com", "currency": "INR"}]

    def save_prices(self, retailer_id, products):
        self.saved.append(retailer_id)
        return len(products)

    def save_fx(self, as_of, rates):
        pass


class BlockedClient:
    def __init__(self, *a, **k):
        pass

    def get(self, url):
        raise SiteBlocked("https://bengaluru.shopdutyfree.com", 403, "Akamai edge 'Access Denied'")

    def close(self):
        pass


def test_blocked_site_is_a_warning_not_a_failure(monkeypatch, caplog, capsys):
    monkeypatch.setattr(store, "SupabaseStore", FakeStore)
    monkeypatch.setattr(cli, "PoliteClient", BlockedClient)
    monkeypatch.setattr(cli, "rates_to_inr", lambda cur: (date(2026, 11, 11), {}))
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    caplog.set_level(logging.INFO)

    assert cli.main(["run"]) == 0
    assert FakeStore.saved == []  # nothing saved, so the old prices stay
    assert "blocked by the site" in caplog.text and "robots.txt disallows" not in caplog.text
    assert "::warning title=BLR Duty Free blocked::" in capsys.readouterr().out
