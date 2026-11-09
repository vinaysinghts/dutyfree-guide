# ADR-0007: Photo-first reports read with on-device OCR

**Status:** accepted, 2026-11-09 (option chosen by product owner)

## Context
Travellers at a duty-free shelf won't type five fields. They will take one photo. We need to turn a
shelf-tag photo into product, size, price and currency, then send it for review.

## Options
| Option | Accuracy on tags | Cost | Works on web | Notes |
|---|---|---|---|---|
| Claude vision on the server | Best: understands which number is the price, handles angles, promos, two currencies | ~₹0.5–1 per photo + API key | Yes | Photo leaves the device |
| **On-device OCR + our own parser (chosen)** | Good text; picking the right number is our job | Free | Yes (Tesseract.js) | Private, offline-capable, instant |
| Photo only, reviewer types | n/a | Free | Yes | All the work moves to the reviewer |

## Decision
- **Phones:** Google ML Kit text recognition (`@react-native-ml-kit/text-recognition`). Fast, free, offline. Requires a development build (not Expo Go).
- **Web:** Tesseract.js (WebAssembly), assets **self-hosted** under `/ocr` (see problems log #6).
- **Interpretation:** `client/lib/shelfTag.ts` turns OCR lines into a draft. It classifies every amount as `now` / `price` / `was` / `per_unit` / `multibuy` and picks the price a traveller pays. It also finds the size, matches the brand against a list and guesses the product line. It returns a confidence score; below 0.6 the form opens for the user to check.
- The OCR text and draft are stored with the report so the reviewer sees what the machine read.

## Consequences
- 👍 Zero running cost and no photo leaves the device for reading. The photo itself is still uploaded as evidence for review.
- 👍 The parser is deterministic and unit-tested, including against **real Tesseract output** (`shelfTag.test.ts`).
- 👎 OCR errors are ours to absorb: `₹` read as `¥`, dropped decimal points, lost lines. The parser tolerates these, and the reviewer corrects the rest.
- 👎 Heuristics need tuning per region (e.g. Middle-East tags in Arabic numerals aren't handled).

## Revisit when
Reviewer correction rate is high (measure: % of approved reports whose fields differ from the OCR draft).
At that point, Claude vision as a server-side second pass for low-confidence drafts only would keep
cost proportional to difficulty.
