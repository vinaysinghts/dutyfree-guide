# ADR-0009: Android APKs built on GitHub Actions

**Status:** accepted, 2026-11-09

## Context
The product owner wants to install the app on a Pixel by downloading an APK, without running a dev
server or installing Android Studio. ML Kit OCR means Expo Go can't be used (native module).

## Options
| Option | Needs | Cost | Notes |
|---|---|---|---|
| **GitHub Actions + Gradle (chosen)** | Nothing beyond the repo | Free (public/private minutes) | `expo prebuild` generates `android/`, Gradle builds a release APK |
| EAS Build (Expo cloud) | Expo account, `eas login` | Free tier with queue | Simplest for store builds later; manages signing keys |
| Local Android Studio | SDK, JDK, ~10 GB | Free | Fastest iteration, but per-machine setup |

## Decision
`.github/workflows/android-apk.yml`:
- Continuous Native Generation: `android/` is not committed; `expo prebuild` recreates it from `app.json`, so native config lives in one place.
- `assembleRelease` bundles the JavaScript into the APK, so it runs standalone.
- Built for `arm64-v8a` only (every current phone, incl. Pixel 10) to halve build time and size.
- PRs get the APK as a run artifact; `main` publishes it to a fixed `android-latest` release for a stable phone-friendly link.
- Supabase settings come from optional repo secrets; without them the APK runs in demo mode.

## Consequences
- 👍 One tap install on any Android phone; every merge produces a fresh build.
- 👎 Signed with the **debug keystore**: Android only lets an APK update another with the same signature, and CI runners generate a new debug key each time... except Expo's template ships a fixed `debug.keystore`, so updates install over each other. Not acceptable for the Play Store.
- 👎 Not for iOS: sideloading isn't possible there; TestFlight via EAS is the route.

## Revisit when
Publishing to the Play Store: move to EAS Build (or a Gradle signing config with a keystore in
GitHub secrets) and produce an `.aab`.
