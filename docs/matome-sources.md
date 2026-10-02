# スレまとめコーナー

## Scope and separation

The user requested a separate collection of thread-summary blogs, with ゲーム / アニメ / 雑談 / ネタ switching. It is an additive homepage section after personal news. The earlier removal of the old matome tab does not require restoring its old data population or ranking logic.

Only publisher-provided public RSS is collected. No raw 5ch scraping, forum account, browser challenge bypass, article-body scraping, AI-written summary, or paid service is involved. Items never enter `home-news`, Today Internet, verification scores, or important-news rankings. Cards attribute the original publisher and link directly to its summary article. The section explicitly describes its contents as forum reactions and humour rather than verified news.

## Initial sources

Verified on 2026-10-02 with ordinary HTTP requests and XML parsing:

| Publisher | Public feed | Evidence | Observed format / items |
| --- | --- | --- | --- |
| ゲーハー黙示録 | https://aatyu.livedoor.blog/index.rdf | [Publisher About/RSS](https://aatyu.livedoor.blog/archives/1774393.html) | HTTP 200, RSS 1.0/RDF, 20 items |
| ジャンプまとめ速報 | https://jumpmatome2ch.biz/feed | [Publisher About/RSS](https://jumpmatome2ch.biz/archives/17) | HTTP 200, RSS 2.0, 15 items |
| 哲学ニュースnwk | https://nwknews.jp/index.rdf | [Publisher site](https://nwknews.jp/) and direct XML response | HTTP 200, RSS 1.0/RDF, 10 items |

The observed counts are acquisition evidence, not future availability promises. ああ言えばForYou returned a small `Site Unavailable` HTML document and was excluded. ねいろ速報 returned HTTP 502 during evaluation and was excluded. あにこ便 advertised a valid feed but appeared inactive for current news, so was not included in this initial selection.

## Classification and content bounds

- Entry-level categories and title evidence are used. Game/anime specialist scope is only a fallback for otherwise unclassified entries; one article can legitimately appear in multiple tabs
- The アニメ tab includes related manga discussions from the anime/manga publisher
- ネタ requires humour evidence such as a joke/copypasta category or title; it is not a fallback for unrelated news, and ネタバレ alone is not humour evidence
- The mixed 哲学ニュース feed admits discussion, science/trivia, everyday-life, game/anime and humour categories. Its general-news/crime/foreign-news categories are not a second news feed
- Sale/affiliate promotions, explicit-sexual/shock headlines, and obvious serious personal-harm allegations are excluded by a conservative title/category filter
- No third-party images or thread excerpts are published. Filtering is a heuristic, not a guarantee about all content encountered after following an external link
- Publication dates must be present and parseable. Entries older than seven days, implausibly future-dated entries and non-article/off-publisher links are dropped

## Automatic refresh and failure behavior

`npm run refresh:matome` runs `scripts/fetch-matome-threads.mjs` directly. `npm run refresh` invokes the same function as a final sequential stage, after the existing news/thumbnail stages. The existing `.github/workflows/refresh-news.yml` runs that pipeline at `:07` and `:37`, commits all `data/` changes and deploys the site. No separate manually curated data path is used.

The collector fetches three feeds serially, with a 15-second timeout and at most one retry for transient failures. 403/404 and malformed/HTML responses are not retried. XML parsing is bounded, rejects DTD/entity expansion, handles RSS/RDF/Atom, and does not select enclosure links as articles.

`data/matome-threads.json` holds at most 60 articles per source for seven days. URL canonicalization removes tracking/fragments and preserves publisher article identity. Rolling feeds are merged with recent retained entries. A failed source retains its own still-valid previous articles; a healthy source does not erase another source's cache.

Timestamp meanings:

- `publishedAt`: publisher's article date, never the fetch time
- `firstSeenAt`: first successful capture of this identity
- `fetchedAt`: last capture of this article in the publisher feed
- `sources[].lastSuccessAt`: last successful request and XML parse for that feed
- `generatedAt`: last attempt with at least one successfully parsed feed
- `checkedAt`: latest collection attempt, including outages

An all-feed outage retains valid articles and their publication/capture timestamps, marks source failures and cached entries, and does not advance `generatedAt`. If no usable articles exist during a complete outage, no empty successful snapshot replaces the existing file. The browser also removes expired cards and shows delayed acquisition status. UI refresh failure retains the last valid in-memory view without resetting the selected tab or expanded count.

## Local reader preferences

The collapsed 「スレまとめの表示設定」 panel can reorder all four categories and hide individual publishers. Its scope is only this section in this browser. No account, remote service, tracking, collector change, shared JSON mutation, or effect on factual-news sections is involved.

- Without saved settings, the existing ゲーム → アニメ → 雑談 → ネタ order and all publishers remain visible
- Up/down buttons support keyboard operation. Changes remain a draft until 「設定を保存」 is selected. The selected tab stays selected on save, while the first preferred category is selected on the next page load. Arrow keys, Home and End follow the saved order
- Publisher choices come only from validated `payload.sources`; hidden sources are removed before computing tab counts and six-item pagination. Empty filtered results explain how to revisit the settings
- Save/reset restart pagination safely at six per category. Background refresh preserves selection, expanded counts, unsaved edits and keyboard focus; invalid refresh data retains the previous valid view
- `matome-preferences.js` uses the independent key `internet-news-matome-preferences-v1` with `{ version: 1, categoryOrder, hiddenSourceIds }`. Unknown versions fall back to defaults, categories are restricted to the four supported IDs, duplicates are removed, missing categories are appended in default order, and source IDs are restricted to the currently validated publisher list
- Missing, malformed or blocked storage never prevents reading. If saving fails, the UI applies preferences for the current page and explicitly warns they were not saved. Reset removes only this section's key; a failed removal restores defaults for the current page and warns that older settings may return after reload

Source choices and saving become available after the first valid source payload; resetting remains available during an acquisition outage. This avoids overwriting stored publisher choices with an unknown source list.

## Verification

Run `node --test tests/*.test.mjs`, syntax checks for changed JS/MJS, and `git diff --check`. Focused fixtures cover RDF/Atom/RSS, publication dates, canonical URL identity, safety filters, classification, partial/total failures, permanent-failure non-retry, bounded retention and scheduled-pipeline wiring. A real `npm run refresh:matome` must produce current direct publisher links before release; HTTP 200 alone is insufficient.

Desktop/mobile browser checks cover all four tabs, keyboard activation, pagination, repeated refresh/error retention, source links, freshness labels, and navigation overflow. Check the actual scheduled GitHub Actions run after deployment; local acquisition is not evidence that the deployment runner can fetch those same sources.

Preferences fixtures in `tests/matome-preferences.test.mjs` cover malformed/unknown/duplicate settings, storage read/write/removal failures, repeat save/reset, source-filtered counts/pagination, preferred tab navigation, and controller focus/refresh behavior. The optional Playwright check is `node tests/matome-preferences-browser.mjs` with a local server at `http://127.0.0.1:8000` (override with `MATOME_TEST_BASE_URL`); it checks desktop and mobile settings, reload persistence, keyboard order, safe output, outages, and blocked storage.
