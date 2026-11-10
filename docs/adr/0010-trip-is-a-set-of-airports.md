# ADR-0010: A trip is a set of airports, not an ordered route

**Status:** accepted (2026-11-10)

## Context
The trip screen let travellers order airports (↑ ↓) and showed the route as `BLR → AMS`. A user
asked whether they need to enter the outbound and return legs separately.

## Decision
For comparing prices, a trip is the **set** of airports the traveller will pass through. The UI
no longer offers reordering or arrows, and a return trip simply reuses the same airports.
The list stays ordered in storage (`trip_airports.position`, the device's saved trip).

## Why
- Price comparison only needs "which shops can I reach". Order adds input effort and nothing else.
- Order does matter for features we haven't built: liquid rules at a connection's security
  check (tamper-evident bags), and the customs allowance at the final destination. Keeping the
  column costs nothing, and removing UI no one benefits from yet is cheap to reverse (YAGNI).

## Consequences
- Simpler trip screen. Every compare card lists every chosen airport, with "No price yet" gaps.
- When order-aware hints arrive, reordering comes back with a reason the user can see.
