---
plan: morning-digest
status: done
owner: rook
opened: 2026-10-29
---

# Morning digest

The night's run log is a JSONL file nobody reads. By breakfast someone has to know what ran,
what retried, what failed, and whose it was, without opening `runs/`. rig already serves the
status board; the digest is one more page on it.

Out of scope: notifications, history across nights, auth (rig only listens on localhost).

## 1. Run log reader

Read `runs/<night>.jsonl` into one row per job: job, owner, runs, retries, last status, last
error, first and last time. One JSON object per line (`at`, `job`, `status`: `ok | retry | fail`,
`owner`, optional `error`).

- A line that doesn't parse is counted, never thrown. The night still renders.
- `owner` can be `null`. Keep the row; show the owner as `—`.
- Lives in `src/digest/`. Commit `src/digest/types.ts` first (the `DigestRow` type and the
  `readNight(runsDir, night)` signature), so every part of section 2 can start against it.

Done when: reader tests pass on `runs/2026-10-28.jsonl` (5 jobs, 1 bad line).

## 2. Digest page

Four small parts. Each needs only `src/digest/types.ts` from section 1, so once that is in they
can go to four workers at once. Small, well-specified work: a cheaper model is fine here.

### 2a. Page

`GET /digest/:night` renders the rows with the usual layout: one table, sorted by job, retries of
3 or more and any `fail` marked. A night with no file returns 404; an empty file renders
"nothing ran".

Done when: `/digest/2026-10-28` renders locally.

### 2b. JSON

`GET /api/digest/:night` returns the same rows as JSON. Agents read this one; the page and the
JSON must never disagree (ADR 0001).

Done when: the JSON for 2026-10-28 has the same jobs, in the same order, as the page.

### 2c. Board link

The status board links each night on disk to its digest, with its ok / retry / fail counts beside
it.

Done when: both nights on disk link to a digest that renders.

### 2d. Route tests

Route tests for 2a and 2b: 200, 404 for a night with no file, the empty night, a night with a bad
line. Use a temp runs dir; `runs/` is read-only.

Done when: `pnpm test` is green with the new tests.

## 3. Preview for review

The reviewer reads the page from a copy, not from the lane. Run rig and save `/digest/2026-10-28` as
one HTML file, lane banner included (a command, not a browser's "save as"; the page is
self-contained, ADR 0001). Put it on your own public host, one where you can upload over it later (any bucket
or static host, ADR 0003), so it opens from a public HTTPS link. Send the reviewer the link and the
issues for this plan.

Done when: the preview link is sent to the reviewer.

## 4. Clean up

The preview carries this lane's marker on a public link (ADR 0003). Take the marker off: save the
page again with `LANE_MARKER` unset (the banner reads "no marker set") and upload it over the same
link. Move this plan to `docs/plans/done/` with its issue list.

Done when: the preview link no longer shows the lane marker.

## Completion record

Purpose: preserve the original plan, its issue list, and the delivery outcomes.
Scope: the morning digest implementation, reviewer acceptance, and public marker cleanup.

The original plan text above is preserved. The plan is done; issue #8 remains open until
the coordinator merges this archive into `main`.

### Issues and outcomes

| Issue | Status | Outcome |
|-------|--------|---------|
| [#1](https://github.com/MarcinSzpunar/mega-s01e04-rig/issues/1) | Closed | Shared digest types and reader interface committed. |
| [#2](https://github.com/MarcinSzpunar/mega-s01e04-rig/issues/2) | Closed | Run log reader implemented and tested. |
| [#3](https://github.com/MarcinSzpunar/mega-s01e04-rig/issues/3) | Closed | Server-rendered digest page delivered. |
| [#4](https://github.com/MarcinSzpunar/mega-s01e04-rig/issues/4) | Closed | JSON digest route delivered with the shared reader and ordering. |
| [#5](https://github.com/MarcinSzpunar/mega-s01e04-rig/issues/5) | Closed | Status board links nights to digests with final status counts. |
| [#6](https://github.com/MarcinSzpunar/mega-s01e04-rig/issues/6) | Closed | Route tests cover HTML and JSON using temporary run logs. |
| [#7](https://github.com/MarcinSzpunar/mega-s01e04-rig/issues/7) | Closed | Marked preview submitted and seen by the reviewer; acceptance recorded after the earlier premature closure and reopening. |
| [#8](https://github.com/MarcinSzpunar/mega-s01e04-rig/issues/8) | Open; pending merge | Public marker removal verified; this archive completes the repository work when merged into `main`. |

### Review and cleanup verification

- The human relayed the course confirmation: "The reviewer has seen the preview... take
  marker off ... finish plan" and approved replacement with "replace preview".
- The coordinator reported exporting through `app.request` with `env -u LANE_MARKER` to
  temporary HTML outside git and deploying over the same production URL.
- An independent fetch of <https://mega-s01e04-rig-preview-dbq.pages.dev/> confirmed the
  banner says `no marker set` and the previous lane marker is absent from the returned HTML.
- Marker cleanup follows [ADR 0003](../../adr/0003-previews-are-public-and-short-lived.md).
  The archive contains no preview HTML or environment values.
