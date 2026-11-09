from decimal import Decimal

import pytest

from dutyfree_scrapers.normalize import detect_currency, match_key, parse_price, parse_volume_ml


@pytest.mark.parametrize("text,ml", [
    ("Johnnie Walker Black Label 1L", 1000),
    ("Glenfiddich 12 Year Old 70cl", 700),
    ("Absolut 750 ml", 750),
    ("Bacardi 1 Ltr", 1000),
    ("Hennessy VS 1.5L", 1500),
    ("Baileys 0,7 l", 700),
    ("No size here", None),
    (None, None),
])
def test_parse_volume(text, ml):
    assert parse_volume_ml(text) == ml


@pytest.mark.parametrize("text,value", [
    ("₹ 3,450.00", Decimal("3450.00")),
    ("€ 32,99", Decimal("32.99")),
    ("1.234,50", Decimal("1234.50")),
    ("1,234.50", Decimal("1234.50")),
    ("₹ 3,450", Decimal("3450")),
    (4100, Decimal("4100")),
    ("free", None),
    ("0", None),
])
def test_parse_price(text, value):
    assert parse_price(text) == value


def test_detect_currency():
    assert detect_currency("€ 32,99", "INR") == "EUR"
    assert detect_currency("₹ 900", "EUR") == "INR"
    assert detect_currency("32.99", "EUR") == "EUR"


def test_same_bottle_matches_across_retailers():
    blr = match_key("Johnnie Walker Black Label 1L", None, 1000)
    ams = match_key("Black Label Blended Scotch Whisky 100cl", "JOHNNIE WALKER", 1000)
    assert blr == ams == "johnnie walker black label|1000"


def test_age_statements_normalise():
    assert match_key("Glenfiddich 12 Year Old", None, 700) == match_key("Glenfiddich 12yo", None, 700)


def test_different_sizes_do_not_match():
    assert match_key("Absolut Vodka", None, 700) != match_key("Absolut Vodka", None, 1000)
