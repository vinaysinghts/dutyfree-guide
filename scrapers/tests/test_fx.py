from decimal import Decimal

import httpx

from dutyfree_scrapers.fx import rates_to_inr


def client_returning(rates: dict, seen: list):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.params["symbols"])
        return httpx.Response(200, json={"base": "INR", "date": "2026-11-13", "rates": rates})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_aed_is_derived_from_the_usd_peg_not_asked_for():
    seen: list = []
    # 1 INR = 0.0119 USD, i.e. ~84.03 INR per USD.
    as_of, rates = rates_to_inr(["AED", "EUR", "INR"], client_returning({"USD": 0.0119, "EUR": 0.0105}, seen))
    # The ECB has no AED rate, so we never ask for it (problems log #19).
    assert seen == ["EUR,USD"]
    assert rates["USD"] == Decimal("84.033613")
    assert rates["AED"] == (rates["USD"] / Decimal("3.6725")).quantize(Decimal("0.000001"))
    assert Decimal("22.8") < rates["AED"] < Decimal("22.9")
    assert rates["INR"] == 1 and str(as_of) == "2026-11-13"


def test_an_unknown_currency_is_left_out_not_fatal():
    seen: list = []
    _, rates = rates_to_inr(["XYZ", "USD"], client_returning({"USD": 0.0119}, seen))
    assert "XYZ" not in rates and "USD" in rates
