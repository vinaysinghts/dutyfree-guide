# Price scrapers

Python package that collects duty-free liquor prices once a day and writes them to Supabase.
Design: [ADR-0003](../docs/adr/0003-python-scrapers-adapter-pattern.md), policy:
[ADR-0004](../docs/adr/0004-scraping-policy.md), algorithms: [LLD §3](../docs/lld.md).

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
pytest
```

## Before enabling the daily run
The adapters were written without access to the live sites. For each retailer:
1. Read the site's terms of use and `robots.txt`.
2. Dry run and inspect the output:
   `dutyfree-scrape run --dry-run --adapter shopdutyfree --base-url https://bengaluru.shopdutyfree.com -v`
3. If nothing comes back, save a category page (`curl … > page.html`), run
   `dutyfree-scrape parse page.html --adapter shopdutyfree`, fix the selectors / category paths,
   and add the page as a test fixture.
4. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as GitHub Actions secrets and set the
   repository variable `SCRAPE_ENABLED=true`.

## Adding an airport
- Same platform as an existing adapter (e.g. another shopdutyfree.com airport): insert a row into
  `retailers` with that `adapter`, `base_url` and `currency`. No code needed.
- New platform: subclass `Adapter` in `dutyfree_scrapers/adapters/`, register it in
  `adapters/__init__.py`, and add a fixture test.
