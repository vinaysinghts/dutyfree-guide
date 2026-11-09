"""Command line entry point.

    dutyfree-scrape run                     # all active retailers -> Supabase
    dutyfree-scrape run --dry-run --adapter shopdutyfree --base-url https://bengaluru.shopdutyfree.com
    dutyfree-scrape parse tests/fixtures/x.html --adapter schiphol   # test a saved page
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .adapters import ADAPTERS
from .fetch import PoliteClient
from .fx import rates_to_inr

log = logging.getLogger("dutyfree_scrapers")


def _make_adapter(slug: str, base_url: str, currency: str | None):
    cls = ADAPTERS[slug]
    adapter = cls(base_url)
    if currency:
        adapter.currency = currency
    return adapter


def cmd_run(args: argparse.Namespace) -> int:
    client = PoliteClient(delay_seconds=args.delay)
    try:
        if args.dry_run:
            if not args.adapter or not args.base_url:
                print("--dry-run needs --adapter and --base-url", file=sys.stderr)
                return 2
            adapter = _make_adapter(args.adapter, args.base_url, args.currency)
            for product in adapter.crawl(client):
                print(json.dumps(product.as_json(), ensure_ascii=False))
            return 0

        from .store import SupabaseStore

        store = SupabaseStore()
        failures = 0
        currencies = set()
        for retailer in store.retailers():
            if args.adapter and retailer["adapter"] != args.adapter:
                continue
            currencies.add(retailer["currency"])
            adapter = _make_adapter(retailer["adapter"], retailer["base_url"], retailer["currency"])
            try:
                products = list(adapter.crawl(client))
                saved = store.save_prices(retailer["id"], products)
                log.info("%s: saved %d prices", retailer["name"], saved)
                if saved == 0:
                    failures += 1
            except Exception:  # keep going so one broken site doesn't stop the rest
                log.exception("%s failed", retailer["name"])
                failures += 1
        as_of, rates = rates_to_inr(sorted(currencies | {"EUR", "USD", "GBP", "AED"}))
        store.save_fx(as_of, rates)
        return 1 if failures else 0
    finally:
        client.close()


def cmd_parse(args: argparse.Namespace) -> int:
    adapter = _make_adapter(args.adapter, args.base_url or "https://example.invalid", args.currency)
    for product in adapter.parse_listing(Path(args.file).read_text(encoding="utf-8")):
        print(json.dumps(product.as_json(), ensure_ascii=False))
    return 0


def cmd_airports(args: argparse.Namespace) -> int:
    from .load_airports import load

    if args.export:
        from .load_airports import export_bundle

        n = export_bundle(Path(args.export), Path(args.csv) if args.csv else None)
        print(f"wrote {n} airports to {args.export}")
        return 0
    load()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="dutyfree-scrape")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="crawl retailers and store prices")
    run.add_argument("--adapter", choices=sorted(ADAPTERS))
    run.add_argument("--base-url")
    run.add_argument("--currency")
    run.add_argument("--delay", type=float, default=5.0, help="seconds between requests (min)")
    run.add_argument("--dry-run", action="store_true", help="print products as JSON lines, don't store")
    run.set_defaults(func=cmd_run)

    parse = sub.add_parser("parse", help="parse a saved listing page")
    parse.add_argument("file")
    parse.add_argument("--adapter", choices=sorted(ADAPTERS), required=True)
    parse.add_argument("--base-url")
    parse.add_argument("--currency")
    parse.set_defaults(func=cmd_parse)

    airports = sub.add_parser("airports", help="load the OurAirports list into Supabase")
    airports.add_argument("--export", metavar="JSON", help="write the app's offline airport list instead")
    airports.add_argument("--csv", help="read a saved OurAirports airports.csv instead of downloading it")
    airports.set_defaults(func=cmd_airports)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
