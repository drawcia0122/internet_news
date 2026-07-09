---
name: unknowns-field-guide
description: Use before writing code for ambiguous, unfamiliar, multi-step, user-visible, or reviewer-sensitive work. Runs a blindspot pass for unknown unknowns, prototypes when needed, plans likely-to-change decisions first, records deviations during substantial work, and produces a review-ready explainer.
---

# Unknowns Field Guide

## Purpose

Use this skill before coding when the request looks workable but first-pass assumptions are likely to be wrong.

The model is simple:

- The prompt and plan are the map.
- The actual codebase, constraints, and reviewers are the territory.
- Unknowns are the gap between them.

This skill is for closing that gap early.

## Use It When

Use this skill when at least one of these is true:

- The task is ambiguous enough that two reasonable implementations could diverge.
- The code path or subsystem is unfamiliar.
- The change crosses files, layers, or teams.
- The behavior is user-visible, security-relevant, or operationally sensitive.
- The work is likely to get non-trivial review scrutiny.

## Skip It When

Do not use this skill for:

- Tiny mechanical edits
- Narrow fixes with an obvious cause and low blast radius
- Work where the code path, expected behavior, and validation are already clear

If the task is simple, do not add process.

## Core Terms

Use the literal phrases `blindspot pass` and `unknown unknowns` when the goal is to find hidden constraints.

Classify uncertainty only if it helps:

- Known Knowns: already stated facts
- Known Unknowns: obvious open questions
- Unknown Knowns: preferences clearer from options than prose
- Unknown Unknowns: hidden constraints, prior art, failure modes, or review expectations

Do not turn this into ceremony for small tasks.

## Default Workflow

1. Run a `blindspot pass`.
Read the relevant code, tests, configs, logs, docs, and nearby patterns first.
List only the unknowns that could change the implementation.

2. Resolve local unknowns before asking the user.
Prefer evidence from code and tests over speculation or premature questions.

3. Prototype only when recognition is easier than description.
Keep it cheap:

- Mockup
- Screenshot
- Diagram
- Sample payload
- Small proof of concept

4. Ask a question only if the answer would materially change:

- Architecture
- Data shape
- Security or permissions
- UX behavior
- Scope
- Cost
- Rollout

Ask one question at a time when needed.

5. Plan in change-sensitive order.
Decide likely-to-change items first:

- Data model
- Interfaces
- Behavior
- Security and permissions
- Migration or rollout
- Validation

Leave mechanical edits for later.

## During Implementation

For substantial work, keep short notes on:

- Decisions
- Deviations
- Edge cases
- Evidence
- Validation

If you hit an edge case that forces a deviation, choose the conservative path, note it, and continue unless the risk is too high.

Skip formal notes for trivial work.

## After Implementation

For reviewable work, explain:

- What changed
- Why it changed
- Which unknowns were resolved
- What evidence resolved them
- What risks remain
- What reviewers should inspect first

Add a quiz only for substantial changes where handoff or review readiness is genuinely important.

## Minimum Output

For short tasks, output only:

- Blindspots checked
- Plan
- Validation
- Remaining risks

Add implementation notes only if they add value.

For larger tasks, include:

- Unknowns brief
- Plan
- Implementation notes
- Review explainer
- Remaining risks

Keep every section short. If a section needs only one line, use one line.

## Templates

### Short Task

```md
Blindspots checked
- ...

Plan
- ...

Validation
- ...

Remaining risks
- ...
```

### Larger Task

```md
Unknowns brief
- ...

Plan
- ...

Implementation notes
- Decisions: ...
- Deviations: ...
- Validation: ...

Review explainer
- What changed and why: ...
- Reviewer focus: ...

Remaining risks
- ...
```
