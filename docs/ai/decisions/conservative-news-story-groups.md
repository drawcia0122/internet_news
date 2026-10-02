# Conservative display-only news story groups

- status: active
- created: 2026-10-02
- last_verified: 2026-10-02
- source_task: User-approved same-story grouping with alternative publisher links
- evidence: `shared-topic-utils.js`, `app.js`, `news.js`, `tests/news-story-grouping.test.mjs`, `tests/news-story-consumers.test.mjs`

## Decision

General-news cards can group multiple original articles describing the same precise event. Grouping is a display wrapper (`storyArticles`), never an article-identity or metadata merge. Preserve each member's original URL, title, summary and image; the representative retains all its own fields. A native `details` disclosure exposes every article with its publisher. Do not nest the disclosure inside a card anchor.

`prepareNewsListItems()` uses safe, tracking-normalized article URL identity only. It must not use the legacy fuzzy topic merger, which can discard distinct articles or transfer fields between them. The legacy `dedupeTopics()` behavior remains for separate trend/discovery consumers, and cross-section article-identity exclusions remain unchanged.

Both general-news consumers filter the original articles before grouping. Search, category and period changes must recover any matching publisher article, even if it was previously collapsed. Group before pagination and count visible cards as 話題; all-news additionally displays the underlying 記事 count when different. Do not persist groups in place of their original article collection.

## Conservative evidence and limitations

- Match a sufficiently long full headline after only typography, exact known publisher labels, and limited sentence-final announcement inflection normalization, within a strict 24-hour publication span
- A secondary rule requires the same long quoted work name, the same explicit release date/action, exact numeric facts, compatible explicit named roles/edition qualifiers, and high headline bigram overlap. A franchise or product name alone never qualifies
- Missing publication time does not borrow capture time. Only the explicit absolute-year release-date rule can match undated legacy articles
- Every member must match every other member. Do not permit similarity or time chains through an evolving representative
- Keep names, numbers, dates, negations, actions, editions and path/query identity distinctions. Prefer false negatives; this is deliberately not general semantic clustering or full Japanese named-entity resolution
- Ignore unsafe URL schemes, credentials, malformed URLs and historical media/PDF destinations. Tracking removal is for identity only; links keep their original URL
- Repeated URLs count once. Distinct same-host articles remain accessible without inflating the publisher count

This supersedes only the general-list fuzzy-preparation detail of `general-news-listing-source.md`. It does not replace `cross-section-article-priority.md`: separate publisher articles are still preserved rather than globally excluded.

## Verification

Node fixtures cover Japanese product/franchise/name/number/date/action conflicts, explicit release schedules, temporal and lexical chains, missing dates, tracking repeats, malicious URLs, metadata preservation and large collections. Actual `news.js` consumer tests cover cross-payload grouping, 20-card pagination, article/topic counts, alternate-title search, category/period filters, disclosure markup and home/archive parity. Browser keyboard/visual confirmation must be performed on a reachable preview; local cloud-browser access can be blocked.
