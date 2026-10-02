# Local reader preferences

## Scope

The Classic homepage has an explicit opt-in **マイニュース** filter. Its collapsed settings panel stores a versioned object under `internet-news-reader-preferences-v1` in this browser's localStorage. It has no server/account/sync/analytics path. The separate スレまとめ settings use their own key and do not share these choices.

- `enabled` must be the boolean `true` before any personal conditions apply
- Empty conditions preserve the exact existing personal-news selection, ranking and fallback behavior, even if enabled
- With only exclusions, candidates are filtered before the existing selector/limit, so hidden stories are replaced by the next eligible candidate
- With wanted genres or keywords, a story may match **any** selected genre or keyword. Explicit interests can include categories outside the old fixed interests. Existing adult-content, Japanese-language and upper-section article-identity guards still apply
- Excluded keywords and sources override wanted interests. There is no fallback that restores excluded or nonmatching items when the list is empty
- Keywords match title/summary article text literally after NFKC and case normalization, not regex or broad feed tags. Pokémon retains the article-level brand-evidence rule
- Source IDs are the collector's normalized ID when available, otherwise a normalized publisher hostname. Hiding a source hides personal-news cards containing that source. Stale saved IDs remain visible/removable in settings even when that source is absent from the loaded candidate set
- Filters are only applied to マイニュース. Other sections retain their selectors; existing cross-section duplicate suppression still gives upper sections precedence

The candidate pool is the homepage trend data plus the same paginated `home-news` snapshot used by normal news, with a maximum of 10 personal cards and 5 initially visible. Active positive genres/keywords automatically read later `home-news-page-*` pages until 10 eligible matches are selected or the snapshot is exhausted. Default/disabled/empty-interest settings do not prefetch extra pages. This does not query a separate historical archive or service. Searching and interrupted/partial results are explicit; transient failures retain the page cursor and offer a retry, rather than claiming no matches. Saving or resetting returns this section to its first page and recomputes the count.

Both sections share one page loader, so concurrent requests join the same in-flight page. Preference changes invalidate the old search loop but may reuse its in-flight page in the new filtered view; reset does not cause that old loop to keep fetching. Refreshing the initial snapshot invalidates responses from its old pagination generation. Invalid/repeated page cursors stop with an incomplete-results state rather than looping. Only explicit retry, another saved choice, or snapshot refresh restarts an interrupted personal search.

## Storage and UI boundaries

Only the two preference keys are written/deleted by their respective settings. Unknown versions and corrupt/oversized stored values fall back to safe defaults; lists, categories, keywords and source identifiers are bounded and normalized. Reading never overwrites a corrupt stored value. Storage getter/read/write/removal failures do not stop rendering. Failed saves apply only in memory and clearly say persistence failed; failed resets warn that the old stored value may reappear after reload.

The app's three existing cache initializers use the guarded storage accessor as well, so a blocked localStorage/sessionStorage getter cannot abort the page before the preferences UI starts. Cache formats and fetch behavior are unchanged.

All variable control labels use DOM textContent, and keyword fields use textarea.value. Save is explicit; editing or expanding/collapsing settings does not apply a draft. Native checkboxes, buttons, details/summary and visible focus styles keep controls keyboard-operable. Source-list refresh preserves drafts and focused source controls. Reset clears only the corresponding section's saved preferences.

## Verification

- `node --test tests/*.test.mjs`
- `node --check reader-preferences.js && node --check app.js && node --check home-topic-selection-utils.js`
- `git diff --check`
- With a local static server and Chromium/Playwright available: `node tests/reader-preferences-browser.mjs http://127.0.0.1:8000`
- Matome browser coverage: `MATOME_TEST_BASE_URL=http://127.0.0.1:8000 node tests/matome-preferences-browser.mjs`

Unit/controller fixtures cover opt-in/default equivalence, wanted/excluded precedence, category and source ID validation, brand evidence, identity safety, limit replenishment, malformed/denied/quota-failing storage, repeated save/reset, safe text, and preservation of unsaved changes/focus on source refresh. The separate browser scripts cover the actual page, persistence/reload, keyboard interaction, pagination/counts and narrow-screen overflow. Run real-browser checks before release; controller tests do not establish visual layout quality.
