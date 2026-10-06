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

## Open-tab freshness

The loaded snapshot is re-evaluated on foreground return, focus, BFCache restoration and a single foreground timer (at most one minute, shortened to known offer boundaries). Re-evaluation uses the original source timestamps and makes no network request. Hidden pages suspend the timer and catch up immediately when visible again.

Only changed dashboard sections are rendered. Search results, query, pagination and expanded news are preserved; surviving controls retain keyboard focus, and removed controls fall back to their section heading. Official price aging uses elapsed monotonic time and the maximum observed wall time so a backward system-clock correction cannot revive an expired observation. Mutable-clock lifecycle tests cover the six-hour, 24-hour and shorter declared boundaries.

## Boundaries

Appdetails price snapshots prove only the discounted amount at checking time. The deadline extension below independently establishes exact ending times; missing or inconsistent evidence stays unknown. Keep existing article/source identity, future-publication, trial, membership, merchandise and event-date protections. Do not match different editions or infer eligibility from unrelated platform mentions.


## Exact deadline extension (2026-10-06)

The public official `IStoreBrowseService/GetItems/v1` response can independently prove the end time of a particular purchase option. The collector requests exactly one app with `context.country_code=JP`, `context.language=japanese` and `include_all_purchase_options=true`. `steamDeadlineSourceUrl(appId)` defines the canonical source URL. No API key, sign-in, storefront scraping or publisher date inference is used.

Appdetails must first identify exactly one non-recurring base-game package with a matching title and discounted JPY amount. StoreBrowse must confirm the exact app ID, game type, package ID, single-game purchase option, title, original/final amounts and discount percentage. Both the best purchase option and its sole matching entry must agree. Exactly one active discount must supply an integer Unix-second `discount_end_date` and the matching discount amount. Bundles, mismatched/localization-ambiguous names, stacked discounts, missing data, non-JP response URLs and invalid/past timestamps fail closed. A one-year plausibility bound rejects implausible data without inventing a replacement date.

The additive fields are `endsAt` and `deadlineSource`, both explicitly null when unknown. Provenance records the actual official endpoint URL, the exact Japanese storefront URL, app/package identity, raw `discountEndDate`, JP/JPY/base-game identity, the matching amounts/percentage and the original `checkedAt`. The raw Unix value must equal `endsAt`; source and offer check times must be identical. Date-only storefront labels, article event dates, `freshUntil` and `priceValidUntil` are never transformed into exact deadlines.

The optional read adds at most one bounded 1 MiB request per already-selected app, inside the existing concurrency, timeout, 90-second total budget and article/app limits. It is skipped for non-sales and unproven packages. Failure keeps the valid price and null deadline, with `deadlineStatus` diagnostics. This endpoint's schema is not assumed stable; shape changes remain unknown rather than falling back to guesswork.

Repeated refreshes retain the original proof only with its same price observation, within the existing 24-hour maximum age. A successful new price response does not inherit an old deadline if new deadline evidence is unavailable. Invalid retained provenance is stripped without discarding a valid price. At the exact end instant, the six-hour cache is bypassed to recheck the price; on an outage the original expired proof is retained so consumers can suppress it and avoid resurrecting article claims. Retention never moves the end time or check timestamp.

Verification: `tests/game-sale-deadlines.test.mjs` covers source/offer mismatches, missing/invalid timestamps, expiry boundaries, bounded failures, cache/outage retention and the real refresh writer. A live refresh on 2026-10-06 produced 21 discounted games, 16 verified deadlines and 5 explicit unknowns. Independently retrieved app 240720/package 201019 reported 82000 → 12300 JPY cents, 85%, `discount_end_date=1791478800` (2026-10-08 17:00 UTC). New-release offers carried distinct second-resolution deadlines, rather than inferred seasonal dates.
