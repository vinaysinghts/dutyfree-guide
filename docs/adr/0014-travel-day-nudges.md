# ADR-0014: Ask for a shelf photo at the right moment (travel-day nudges)

**Status:** accepted, 2026-11-13. MVP built.

## Context
Crowd photos are now the main way we get Bengaluru (BLR) prices. We can't get a data feed from
Avolta, and we don't get past bot blocks (ADR-0011, ADR-0013). Photos go through the existing
review queue: on-device OCR (ADR-0007), a location check (ADR-0008), then human review (ADR-0006).

The hard part is getting people to send them. Nobody opens a price app to do us a favour, and we
can't pay a reward. What we *do* have is timing: the traveller has told us which airports they'll
pass through. On travel day they are standing near the shelves, often with time to kill. If we
ask then, with one tap to the camera, the ask costs them about ten seconds.

This ADR covers five questions: how to deliver the ask, when to send it, how time zones and
layovers work, what we do with location, and how we avoid nagging.

## 1. Delivery: local notifications + an in-app card, no server push

| Option | Works with roaming off at the airport | Server work | Trip leaves the phone | Web |
|---|---|---|---|---|
| A. **Server push** (Expo push / FCM / APNs, a cron decides who to ping) | ❌ needs data at that moment | push tokens table, cron, retries, token cleanup | ✅ must upload trips and dates | Web Push needs a service worker |
| B. **Local notifications** scheduled on the phone | ✅ the OS fires it offline | none | ❌ stays on the phone | ❌ |
| C. **In-app card only** | ✅ | none | ❌ | ✅ |
| D. **Geofence** ("entered DXB" wakes the app) | ✅ | none | ❌ | ❌ (and needs "Always" location, §4) |

**Decision: B + C.**
- **Local reminders** on iOS and Android (expo-notifications, `DATE` trigger). The phone already
  knows everything needed to decide, so a server would only add cost, a privacy surface (we'd hold
  everyone's travel dates) and a failure mode: international travellers often have roaming off
  until they find airport Wi-Fi, so a push sent at the right moment is often delivered late.
- **An in-app card** on the trip and prices screens, everywhere including web. It needs no
  permission and catches people who turned reminders off or never turned them on.
- **Not D.** Geofencing needs "Always" background location. §4 covers it in full, because review
  raised it: we get most of its value by checking location whenever the app opens.
- **Revisit A** if we add accounts and want server-side targeting, for example "BLR's whisky
  prices are 30 days old: ask the next five people flying through BLR." That is the point where
  the server knows something the phone doesn't.

## 2. When to ask

The best moment is airside: after security, before boarding. We don't know flight times (there's
no flight API yet, ADR-0010 trip), so we ask for an optional date per airport, and an optional
departure time:

| What the traveller gave us | Reminder fires | In-app card shows |
|---|---|---|
| Date + departure time at that airport | 75 minutes before departure (airport time) | 4 h before to 1 h after departure |
| Date only | 08:00 airport time on that date | All of that date, airport time |
| Nothing | No reminder | Whenever the app is opened at any airport (§4) |

Why 75 minutes: international boarding starts 45–60 minutes before departure, and security takes
15–45. At about T−75 the traveller is most likely walking past the shop. This is a guess, so it's a
single constant (`LIMITS.beforeFlightMin`) we can tune against the data in §6.

**Scheduling is declarative.** `planNudges(stops, history, now)` is a pure function that returns
the reminders that *should* exist. `reconcileReminders(planned)` then compares that with what the
OS has scheduled, cancels the extras and adds what's missing. We run it on every trip change, on
app foreground and every hour. This is the same pattern as React rendering or a Kubernetes
controller: describe the desired state, let a loop converge on it. The imperative alternative
("on add, schedule; on edit, find the old one and move it; on delete, cancel") breaks as soon
as one path is missed, and you get duplicate or orphaned reminders.

## 3. Time zones and layovers

A reminder is an exact instant, but people think in local wall-clock time at the airport. When
the traveller types "DXB, 20 Nov, 09:40" at home in Bengaluru, the phone is in India time. Reading
09:40 in the phone's zone would fire 1.5 hours late.

**Decision: every date and time in the trip is airport-local, and the app knows each airport's
IANA zone.** The offline airport bundle gained a time-zone column, from the MIT-licensed
`airportsdata` package (3,242 of 3,245 airports; the other three fall back to the phone's zone).
`zonedToInstant(date, time, zone)` turns wall-clock time into an instant using only `Intl`. No
date library, and DST is handled (LLD §3.9).

Why not the alternatives:
- **Store in the phone's zone.** Wrong for every airport not in your home zone, which is the whole
  point of a layover.
- **Store UTC instants.** Correct, but the traveller doesn't know their flight in UTC, and we'd
  still need the zone to show it back to them.
- **iOS calendar triggers with a time zone.** Only on iOS; Android has no equivalent.

Once scheduled, a reminder is an absolute instant, so it fires at the right moment even after the
phone switches zone on landing. **Layovers** are just more stops with their own date. A BLR → DXB
→ AMS trip that crosses midnight has DXB on the 21st, even though you left BLR on the 20th. The
form says "(DXB time)" to make that clear.

## 4. Location: "you're at an airport" on app open, while-in-use only

**Question raised in review (2026-11-13):** shouldn't the reminder fire when the phone is
*actually at* the airport, rather than at a time we guess? That's the most accurate signal we
could have, so we worked through what it costs.

**Option G: geofence with "Always" location (rejected).** The OS watches a ~3 km circle around
each trip airport and wakes the app on entry, which then schedules "snap a shelf" for 30 minutes
later (past security).

| Concern | What it means here |
|---|---|
| Permission | Needs "Allow all the time". Android 11+ doesn't even show it as a dialog: we'd have to send people to Settings. iOS asks for "While using" first, then shows a separate "Change to Always" prompt later. Many people refuse, and the ones who don't may trust us less. |
| Store review | Declaring `ACCESS_BACKGROUND_LOCATION` puts the app through Google Play's background-location review (a form plus a video), and the use has to be "core functionality". A reminder to photograph prices is unlikely to pass. The permission would sit in the manifest for *every* user, opt-in or not. Apple scrutinises "Always" the same way. |
| Platform limits | iOS monitors at most 20 regions per app (fine for a trip). Android geofence alerts can arrive minutes late, and the OS removes them after a reboot unless we re-register. |
| Battery | Low: OS geofencing uses cell and Wi-Fi, not GPS. Not the deciding factor. |
| Accuracy | A 3 km circle catches the kerb, the arrivals hall, nearby hotels and staff. Arrival is usually landside, an hour before the shop. |
| Complexity | A background task with no UI; two writers (background task + app) sharing the reminder history, which needs merging; testing on real devices only. |

**Decision: while-in-use location, checked whenever the app opens or comes back to the front.**
- On every open or foreground (at most every 2 minutes) we read the position: last known if it's
  fresh, otherwise one balanced fix. We then find the nearest of all ~3,200 airports. If it's within
  5 km (ADR-0008's `AT_AIRPORT_KM`), the card says **"📍 You're at DXB"**, with one tap to the
  camera. This counts **any airport, not only the trip's**: a traveller who never set up a trip
  still gets asked, and so does someone on an unplanned layover.
- **The time-based reminder (§2) is what gets people to open the app.** The reminder brings them in,
  and the location check then confirms where they are. Together they get most of the geofence's
  value with no background access.
- **How we ask:** a one-time explainer card on My trip ("Notice when I'm at an airport?") shows the
  OS prompt only if they tap Allow. A cold prompt gets refused, and on iOS we only get one. Snapping a
  tag still asks too (ADR-0008). Without permission, the date-based card still works.
- **People who live near an airport:** after "Not this time" on two different days at an airport
  that isn't on their trip, we stop offering it there (`NEARBY_DISMISS_LIMIT`). Their trip airports
  are always offered.
- **Nothing about this leaves the phone**: not the dates, not the reminder history, not the "you're
  here" check. The only new server data is `price_submissions.via` (`manual` / `nudge_card` /
  `nudge_notification`). It's an entry point, not a trip.
- **Notification permission** is asked only when the traveller turns on "Remind me on travel day".
  If it's denied, the switch links to Settings.
- **The permission text was rewritten**: "While the app is open, we use your location to notice
  when you're at an airport and to confirm where a price-tag photo was taken. Never in the
  background." When we change how we use a permission, the text has to change with it. ADR-0008's
  "once, when you snap" no longer holds.
- The lock screen shows "At Dubai (DXB) duty free?". Someone looking at your phone learns you're
  travelling. That's acceptable for an opt-in reminder, and it's why the reminder never includes
  prices.

**Revisit G** only if the data (§6) shows people open the app at airports a lot less than the
reminders predict, *and* we're willing to go through Play's background-location review.

## 5. Notification fatigue

A reminder that annoys people leads them to turn off notifications for the whole app in OS
settings. Then we can never reach them again, so getting this wrong costs more than any one missed
ask. Limits, all in `LIMITS` in `lib/nudge.ts` and unit tested:

| Rule | Value | Why |
|---|---|---|
| Opt-in | off by default | Consent first, especially for a feature that knows your travel days |
| One per airport per travel date, ever | — | If it fired once, changing the flight time doesn't re-ask |
| Per travel date | 2 | A three-stop day still gets at most two reminders |
| Minimum gap | 3 h | Two reminders within the same hour feel like spam |
| Priority when capped | timed stops first, then trip order | A reminder tied to a departure time is likelier to land at the shop |
| Already reported there | skip for 7 days | You did your part. The return leg a week later can ask again |
| "Not this time" on the card | also cancels that airport's reminder | One dismissal means not today, everywhere |
| Back-off | after 3 ignored in a row, stop scheduling | A tap or a report resets it. The in-app card keeps working |
| Pending at once | 4 | iOS caps an app at 64; we want far fewer |
| In-app banner | not shown if the app is open when it fires | The card is already showing the same ask |

An "ignored" reminder is one that fired and wasn't opened within 2 hours. The OS doesn't tell us
when a local notification is *shown*, so we infer it on the next app open (`settle`).

## 6. How we'll know if it works

`price_submissions.via` lets one query answer this:

```sql
select via, count(*), count(*) filter (where status = 'approved') as approved
from price_submissions where created_at > now() - interval '30 days' group by via;
```

We can't measure the denominator (how many reminders fired) without client analytics, and we
chose not to collect any. If `nudge_*` reports beat `manual` over a month of real trips, the feature
earns its keep. If not, the first knob is the timing constant, then the copy.

## Consequences
- 👍 No server, no new secrets, no running cost. Works offline, and the trip stays on the phone.
- 👍 The policy is a pure, tested function, so changing a limit is a one-line change with tests.
- 👎 Reminders need the phone app (a development build or the APK). Expo Go and web get only the card.
- 👎 Typing a date is friction. A date picker and a flight-number lookup that fills date and time
  are the obvious next steps.
- 👎 We can't target airports that need data most (stale BLR prices) without a server (§1, option A).
- 👎 `Intl` time-zone support on Hermes has to be confirmed on a real device. If it's missing, we
  fall back to the phone's zone (problems log #15).

- Rollout order: the APK build and the Supabase migration both run on merge, and either can
  finish first. A new app on an old database would send a `via` column that doesn't exist yet, so
  `submitPrice` retries without it on PostgREST's "unknown column" error (`PGRST204`). The column
  has a default, so an old app on the new database is fine too. This is the "expand, then use"
  half of an expand/contract migration: both orders are safe, so nobody has to deploy in sequence.

## Revisit when
- We add accounts or a flight lookup: then pre-fill the dates, and consider server-side targeting.
- Report data (§6) shows the timing is off.
- An incentive scheme arrives (badges, early access), which would change the copy and maybe the limits.
