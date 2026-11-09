# ADR-0008: Checking where a reported photo was taken

**Status:** accepted, 2026-11-09

## Context
Crowd reports can be fake or wrong (a city liquor-store tag, an old photo, a different airport). We
want a cheap signal that the photo was taken at the airport the user picked.

## Decision
1. **Source of location**, in order:
   - **EXIF GPS** in the photo, if present (gallery photos);
   - **live device location** at capture time, for photos just taken with the in-app camera.
   We ask for location permission only when the user snaps a tag, never in the background.
2. **The server decides the verdict.** The app sends raw coordinates. A database trigger computes
   the distance to the airport with the haversine formula and sets
   `location_check` = `at_airport` (≤ 5 km) / `near` (≤ 50 km) / `far` / `unknown`. Whatever verdict a client
   sends is overwritten, so it can't be forged by editing the request.
3. The app **pre-selects the nearest airport** from the location (`nearest_airports()` RPC).
4. EXIF `DateTimeOriginal` is stored as `photo_taken_at` so reviewers can spot old photos.
5. The verdict is **advisory for reviewers**, not an automatic reject: GPS indoors can be poor and
   many phones strip EXIF on upload.

## Consequences
- 👍 Raises the effort needed to fake a report, at no cost.
- 👎 GPS can be spoofed on a rooted phone, and EXIF can be edited. It's a signal, not proof. Stronger
  options for later: rate limits per user, reputation (approved/rejected ratio), agreement between
  several reporters, or comparison with the scraped price.
- Privacy: coordinates are stored only on reports and readable only by the reporter and admins (RLS).
