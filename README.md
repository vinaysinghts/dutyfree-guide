# Duty Free Guide

Find where each bottle is cheapest on your trip. Add the airports on your route (including layovers)
and see every liquor price at those airports' duty-free shops, converted to INR, cheapest first.

| My trip | Prices | Report a price |
|---|---|---|
| ![](docs/screenshots/2-trip-route.png) | ![](docs/screenshots/3-prices.png) | ![](docs/screenshots/5-photo-report.png) |

## How it works
- **Prices** come from the airports' online shops (collected once a day) and from travellers who
  snap the shelf tag. The tag is read on the device (OCR), the photo's location is checked against
  the airport, and a reviewer approves it before it appears.
- **Currency**: everything is converted to INR with daily ECB rates (Frankfurter).
- **Stack**: Expo (React Native) for web/iOS/Android · Supabase (Postgres, Auth, Storage) · Python scrapers on GitHub Actions.

Design docs: [HLD](docs/hld.md) · [LLD](docs/lld.md) · [Decisions (ADRs)](docs/adr/) · [Problems log](docs/problems-log.md)

## Run the app (no backend needed)
```bash
cd client
npm install
npm run web          # or: npm run ios / npm run android
```
Without Supabase settings the app runs on built-in sample prices ("Demo mode").

**Phones:** shelf-tag OCR uses Google ML Kit, which isn't in Expo Go. Use a development build:
`npx expo run:android` / `npx expo run:ios` (or an EAS dev build). The web app needs nothing extra;
its OCR engine is copied into `client/public/ocr` on `npm install`.

## Connect a real backend
1. Create a free project at supabase.com.
2. Apply `supabase/migrations/*.sql` then `supabase/seed.sql` (SQL editor, or `supabase db push`).
3. In Supabase Auth settings, enable **anonymous sign-ins** (used for price reports).
4. Copy `client/.env.example` to `client/.env` and fill in the project URL and anon key.
5. Make yourself an admin: `insert into admins values ('<your auth user id>');`
6. Load all airports: `cd scrapers && pip install -e . && dutyfree-scrape airports` (needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`).

## Scrapers
See [scrapers/README.md](scrapers/README.md). The daily schedule stays off until each adapter is
checked against the live site.

## Tests
```bash
cd client && npm run typecheck && npm test        # ranking logic
cd scrapers && pytest                             # parsing, matching, airports
PGHOST=... PGUSER=postgres supabase/tests/run.sh  # schema, RLS-backed review flow
```
