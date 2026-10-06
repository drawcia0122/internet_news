# Verified game sale prices

- status: active
- created: 2026-10-06
- last_verified: 2026-10-06
- source_task: Show regular and discounted game prices on sale cards
- evidence: `lib/game-sale-offers.mjs`, `scripts/fetch-game-sale-offers.mjs`, `game.js`, sale ingestion and consumer tests

## Decision

Game sale cards use a separate bounded `game-sale-offers.json` enrichment stage. Recent sale articles discover official Steam app links within their article body and individual product paragraph. Prices, currency, title and base-game identity come from that exact app's official Japanese Steam response, never from a roundup's cheapest amount or reverse-calculation of a rounded percentage.

The browser joins by the canonical named article identity, validates JPY / JP / base-game provenance, and displays regular price → sale price, the supplied discount percentage, platform, source and actual price-check timestamp. Both numeric amounts retain explicit roles. Missing regular prices remain unknown.

## Freshness and fallback

A successful official observation is fresh for at most six hours. An outage can retain the original checked timestamp for at most 24 hours, visibly marked as awaiting recheck. The generation timestamp never refreshes a cached price. Official zero-discount or unavailable outcomes supersede historical article claims. Invalid/missing enrichment must not break the remaining game page.

The ordinary refresh runs the stage after thumbnail repair. The refresh health guard tracks the separate file but must not restore an obsolete sale because legitimate expiration reduced the number of offers. No generated price JSON is repaired by hand.

## Boundaries

This does not establish sale ending times. Store price snapshots prove only the discounted amount at checking time; a deadline is shown only when independently grounded. Keep existing article/source identity, future-publication, trial, membership, merchandise and event-date protections. Do not match different editions or infer eligibility from unrelated platform mentions.
