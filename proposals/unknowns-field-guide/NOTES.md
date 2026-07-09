# Unknowns Field Guide Notes

This draft keeps the intent of the original proposal, but trims it for day-to-day Codex use.

## Main Adjustments

- Narrowed trigger conditions so the skill does not fire on small obvious edits.
- Compressed the output contract so short tasks stay short.
- Strengthened the rule to inspect code, tests, configs, logs, and nearby patterns before asking the user.
- Limited questions to decisions that materially change the solution.
- Kept notes and quiz optional except for substantial review-sensitive work.
- Preserved `blindspot pass` and `unknown unknowns` as explicit terms because they are the core of the method.

## Why These Changes

- The original draft is strong for difficult work, but too heavy as a default wrapper.
- Small tasks need speed, not ritual.
- Reviewer-sensitive tasks still benefit from evidence, deviations, and explicit remaining risk.
- Asking too early is often slower than reading the actual code path.

## Recommended Use

Treat this as a pre-implementation skill for:

- Ambiguous work
- Unfamiliar systems
- Multi-step changes
- User-visible changes
- Review-sensitive implementation

Do not treat it as a universal wrapper around every edit.
