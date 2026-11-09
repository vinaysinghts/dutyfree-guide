# ADR-0001: Expo (React Native) for web, iOS and Android

**Status:** accepted, 2026-11-09

## Context
We need a web app and mobile apps, maintained by one person. The hot path is "search airports,
see a ranked list": simple UI, no heavy native features (only the photo picker).

## Options
| Option | For | Against |
|---|---|---|
| **Expo / React Native** | One TypeScript codebase for 3 platforms; Expo Router gives file-based routes on all of them; OTA updates | Web output is a client-rendered SPA by default, so weaker SEO |
| Flutter | Excellent mobile rendering | Web is a canvas app (poor SEO, accessibility); Dart is a smaller hiring pool |
| Next.js PWA | Best SEO; fastest web launch | Not in app stores; camera/photo and offline need workarounds |
| Next.js + Expo monorepo | Best of both | ~1.5× the work; two UI layers |

## Decision
Expo with Expo Router and TypeScript. Web is exported as a single-page app (`web.output: "single"`).

## Consequences
- 👍 Every screen ships to every platform; one set of tests.
- 👍 TypeScript types (`lib/types.ts`) mirror the database view, so a schema change shows up as a compile error.
- 👎 Search engines see little content. Acceptable while the users are people we send links to.
- 👎 Static rendering (`output: "static"`) didn't emit the JS bundle in this SDK; see problems log #3.

## Revisit when
SEO becomes a growth channel: add a Next.js site for landing pages that reuses `lib/compare.ts`.
