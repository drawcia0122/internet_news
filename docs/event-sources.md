# Event collection sources

`npm run refresh:events` collects real event items as well as updating the source-candidate registry. Candidate-only entries are not evidence that collection has been implemented.

## Official sources added in October 2026

Verified on 2026-10-02. These adapters require no credentials or paid APIs.

| Source | Collection | Admission requirements |
| --- | --- | --- |
| [PARCO ART](https://art.parco.jp/) | One official event-list HTML response | An event card with explicit start/end dates, same-origin detail URL, and a recognized venue; notices and unknown `その他` venues are excluded |
| [PARCO CAFE](https://cafe.parco.jp/) | One official cafe-list HTML response | A limited-period event card with explicit dates and its enclosing venue header; permanent restaurants and undated openings are excluded |
| [日本科学未来館](https://www.miraikan.jst.go.jp/events/) | Public annual JSON used by the official [`events.js`](https://www.miraikan.jst.go.jp/_assets/js/events.js), then at most 12 sequential official detail requests | A physical event within the collection window, a matching detail-page title, and its `開催場所` field; online and external-partner events are excluded |

Miraikan JSON is `/events/_assets/json/{year}/ja.json` on the official domain. The next year is fetched only if the 75-day upcoming window crosses a year boundary. Detail-page failure fails the source as a whole, preserving the previous source snapshot rather than silently dropping just those events.

PARCO's former THE GUEST site redirects to PARCO CAFE. Use the current canonical cafe source. Tokyo venue/district mappings are restricted to named venues verified in [PARCO ART access](https://art.parco.jp/access/) and [PARCO CAFE access](https://cafe.parco.jp/access/); a generic `TOKYO` venue does not imply Shibuya. Nationwide venue coverage remains available, with existing Tokyo/Kanto prioritization retained.

## Date and selection safeguards

- A date must actually be supplied by the event source. New adapters do not use article publication dates, approximate month boundaries, or an assumed current year as event dates
- Missing end years inherit the printed start year, or the next year for a December-to-January range; impossible/reversed dates are rejected
- Miraikan's sparse `anotherRange` is represented by its next actual session. The description preserves the published schedule; a two-session event is never represented as running continuously between those dates
- Relevance filtering compares Japan calendar dates regardless of the runner's timezone. Events remain eligible through their last day
- Score-ordered source buckets are selected round-robin, with a maximum of 64 items overall and 20 per source. Small new providers therefore survive the global cutoff
- Tokyo and Saitama locations are prioritized within each source bucket and in the displayed type/period results. Nationwide events remain eligible; event titles, recommendations, and provider-wide tags are not geographic evidence
- Pure ticket-discount and parking campaigns are excluded from Yomiuriland collection; actual festivals/collaborations remain eligible

## Failure behavior and verification

Each source has a named diagnostic (`ok`/`failed`, counts, and failure message). Freshly collected items get `sourceCheckedAt`. Failed sources retain their previous items and previous check time, subject to the normal date window and balanced limits. A successful source replaces its prior items. A suspicious zero-item result is treated as a failure unless an adapter explicitly supports a verified empty result (Miraikan). On total source failure, an existing `data/events.json` is left byte-for-byte unchanged; first-run total failure is fatal.

All HTTP requests have a 20-second timeout. No browser challenge or denied source is bypassed. Sunshine City's direct HTML returned HTTP 403 and BOX CAFE returned HTTP 502 during verification; neither was added as an operational source.

Tests:

```sh
TZ=UTC node --test tests/event-sources.test.mjs
TZ=Asia/Tokyo node --test tests/event-sources.test.mjs
node --check scripts/fetch-events.mjs
node --check lib/event-source-utils.mjs
```

`tests/fixtures/events/` contains minimal, unmodified card/field excerpts from the official URLs above and these Miraikan detail pages, captured 2026-10-02:

- <https://www.miraikan.jst.go.jp/events/202610184743.html>
- <https://www.miraikan.jst.go.jp/events/202611284754.html>

Negative cases are created in tests from those excerpts. Live collection is a separate integration check, not a replacement for deterministic fixtures. The existing six adapters retain their legacy date/detail behavior; this change does not claim all legacy undated events have been repaired.
