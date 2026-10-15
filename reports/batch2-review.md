# Batch 2 review — October 15, 2026

Nothing published. No production writes. Task diagnosis was read-only.

## Implementation and limits

Renewal steps, dates, actor attribution, N/A reasons, and plan-handout references
now live on the client/year renewal. Per-plan progress endpoints return 410 and
the old table is retained. Completion requires all seven steps plus every
expected handout. Handout upload/selection is available in the checklist.
Dashboard buckets and stalled renewals use that record.

Dev migration: 46 renewals; 45 eligible, classified exactly once:
39 Upcoming, 6 Current, 0 Complete; 1 suppressed.
Tests cover bucket exclusivity, completion with missing handouts, N/A reasons,
furthest-progress merge, earliest recorded date, and rerun preservation.
Production build passed. Full TypeScript check remains failing in existing
routes/storage/inbox/PPR code; new missing import found during checking was fixed.
Authenticated checklist editing and file upload have not been browser-tested.

## Named clients: dev before/after and production projection

All seven dev client/year pipelines were blank before this migration.
All are 2026 cycles. None is declared complete: missing handouts and unresolved
steps must not be guessed as complete.

|Client|Dev after|Production before → projected after|
|---|---|---|
|S-459 Grand County|Accepted and signed September 1; emailed September 2; 1 handout open|Emailed → same final milestone, corrected confirmed dates; earlier dates/actors unknown|
|S-174 Red Lake|Earlier required steps done, dates unknown; emailed August 26; 1 handout open|Emailed → emailed August 26; not complete without checklist/handout|
|S-200 Saturn|Sent on/before September 16; accepted and signed N/A (“Client proceeded without signing”); emailed September 23; 1 handout open|Blank → same confirmed milestones|
|S-480 MountainSeed|Emailed on/before September 30; 3 handouts open|Processed → emailed; retains earlier September 25 per-plan dates, which satisfy the confirmed upper bound|
|S-465 Alamosa|Accepted October 7; emailed October 14; 1 handout open|Blank client tracker / September 25 plan tracker → merge; confirmed October acceptance/email override September dates|
|S-216 Consulting Radiologists|Suppressed; termination September 30 already recorded|Blank client tracker / Requested September 8 plan tracker → preserve history, suppress renewal|
|S-27 Florida Oral & Facial|Unchanged blank status; 1 expected handout|Unchanged Processed, dates unknown; status remains unconfirmed|

Production projection used a read-only snapshot of clients, renewals, plans,
and renewal_progress and the same pure migration function as dev.
Production has no per-plan progress whose client lacks a renewal record.
Production has 20 HANDOUT documents, but zero linked to both a plan and renewal.
They were not guessed into the checklist.

## Production data step after publishing

Publish must apply the new dev schema columns first. Then separately authorize
the one-time data migration; it is not called at boot.
`scripts/migrate-renewal-progress.ts SNAPSHOT.json --sql` emits a transactional
data-only SQL script from a fresh read-only snapshot. Review before execution.
`--apply-dev` is the dev-only execution option used in this batch.
Never copy dev IDs/data into production. The production projection uses
production IDs. No production data script has been executed.

## Task-list diagnosis (all counts: production, read-only)

At query time Kim had 1,066 open tasks (92 overdue); Steve had 278 (13 overdue).
Counts moved since the morning digest; these are not claimed to be the exact
7:30 snapshot.

|Owner|Legacy email extraction|Gmail extraction|Manual|Renewal automation/import/other explicitly identified|
|---|---:|---:|---:|---:|
|Kim|616|440|10|0|
|Steve|0|278|0|0|

There is no independent import provenance on these task rows. Classification
uses communication_id, gmail_message_id and origin, not guesses from task text.
All 1,056 Kim email tasks and all 278 Steve tasks are OPEN suggestions.
Kim's 10 manual tasks are TODO. The digest includes both OPEN and TODO without
requiring acceptance and without collapsing task groups.

Kim received 424 new Gmail suggestions September 23–October 15, averaging
18.4/day. The Gmail extractor stores every action item regardless of priority.
The legacy email route runs duplicate grouping; the Gmail extraction path does
not invoke that grouping helper. Per-message extraction stamps prevent normal
re-extraction, but repeat mentions across replies still produce suggestions.

Duplicate evidence, not a claim that all new work is duplicate:
- Existing groups: Kim 96 rows / 35 groups = 61 extra rows; Steve 9 / 4 = 5 extra.
- Same owner/client mirror/normalized description: Kim 32 extra rows; Steve 2.
- Exact same Gmail message and normalized description: Kim 3 extra rows.
- These sets overlap and must not be added together.
- Kim's Gmail tasks: 229 came from messages containing quoted text; Steve 101.
  This is not proof of duplication (the extractor prefers the trimmed new body).
- No open Gmail tasks are marked historical-import or linked to pre-2025 mail.

### Tasks created each day, September 16–October 15 (UTC dates)

Counts include all tasks created, whether still open or subsequently resolved.
Manual and other sources were zero on every date in this window.

|Date|Kim legacy email|Kim Gmail|Steve Gmail|
|---|---:|---:|---:|
|Sep 16|57|0|0|
|Sep 17|27|0|0|
|Sep 18|42|0|0|
|Sep 19|1|0|0|
|Sep 20|0|0|0|
|Sep 21|0|8|88|
|Sep 22|0|44|16|
|Sep 23|0|15|35|
|Sep 24|0|6|8|
|Sep 25|0|23|39|
|Sep 26|0|0|10|
|Sep 27|0|6|0|
|Sep 28|0|35|17|
|Sep 29|0|14|4|
|Sep 30|0|27|2|
|Oct 1|0|63|18|
|Oct 2|0|32|6|
|Oct 3|0|0|2|
|Oct 4|0|0|0|
|Oct 5|0|37|1|
|Oct 6|0|14|3|
|Oct 7|0|12|5|
|Oct 8|0|12|0|
|Oct 9|0|0|0|
|Oct 10|0|0|0|
|Oct 11|0|0|0|
|Oct 12|0|0|0|
|Oct 13|0|87|9|
|Oct 14|0|18|12|
|Oct 15|0|23|5|

### Stale links and proposed rules (NOT applied)

|Candidate rule|Count it would close/remove from daily list|Change that prevents recurrence|
|---|---|---|
|Show only accepted TODOs in daily-work digest; leave suggestions in triage|Closes 0; removes 1,056 Kim and 278 Steve suggestions from daily work list; Kim retains 10 TODOs|Digest queries TODO only; explicit acceptance required|
|Resolve redundant rows in existing task groups, retaining one representative and a permanent note|61 Kim + 5 Steve candidate closures|Group at Gmail extraction and collapse groups in digest|
|Resolve exact duplicate description candidates after checking linked clients and notes|32 Kim + 2 Steve candidates, overlapping the group rule|Idempotency/deduplication on normalized ask plus client/thread; never discard human notes|
|Review and resolve obsolete pre-2025 due-date suggestions, or correct dates where still current|25 Kim + 1 Steve candidates; not safe to close automatically|Reject or flag implausible extracted dates before adding to daily work|
|Review renewal-only work for terminated Consulting Radiologists|10 Kim + 3 Steve linked candidates; automatic closures recommended: 0|Suppress renewal reminders on termination, but preserve run-out claims/service tasks|
|Review tasks linked to clients with a legacy final renewal milestone|7 Kim + 2 Steve linked candidates; automatic closures recommended: 0|Link tasks to a renewal explicitly and resolve only renewal-specific work after actual completion|

All 13 terminated-client tasks are linked to S-216. They are not necessarily
renewal work. Tasks have client links, not renewal IDs, so “tied to a completed
renewal” cannot be established reliably. The 7/2 counts are only tasks on clients
whose OLD pipeline says Emailed; the new completeness rule additionally requires
steps and handouts. No task was created before 2025; the old dates are due dates.
Kim's 25 old due dates comprise 17 Gmail and 8 legacy-email tasks; Steve's one is Gmail.

Old due-date IDs (production): Kim 462, 994 (2024-01-09); 1338
(2024-01-10); 1324 (2024-10-01); 653, 654, 655, 656, 995
(2024-10-02); 1350, 1351 (2024-10-06); 1332 (2024-10-15);
1618 (2024-10-16); 642, 643, 644, 996, 997, 1581, 1584
(2024-10-18); 1455, 1580, 1662 (2024-11-01); 1392, 1394
(2024-12-01). Steve 1695 (2020-11-12).

Several “old” due dates are attached to clearly current business, including
Colquitt onboarding and a task mentioning a January 2027 amendment.
Do not equate old due date with obsolete work. The extraction prompt in
server/claude.ts has no explicit current-date reference, and the Gmail caller
passes sender/subject/body without a sent-date reference. The caller accepts
any parseable extracted date. This is a concrete date-quality gap; each
candidate's correct due date still requires review against its source.

## Changed files

- shared/schema.ts; shared/renewal-progress.ts
- server/routes.ts; server/storage.ts; server/renewal-buckets.ts; server/data-reset.ts
- client/src/components/renewal-checklist.tsx
- client/src/components/tabs/plans-tab.tsx
- client/src/pages/client-detail.tsx; client/src/pages/clients.tsx; client/src/pages/dashboard.tsx; client/src/lib/renewal.ts
- scripts/renewal-migration-model.ts; scripts/migrate-renewal-progress.ts
- scripts/verify-renewal-consolidation.ts

Diagnosis also inspected server/digest.ts, server/gmailFullSync.ts and task schema.
Date diagnosis also inspected server/claude.ts. None of these task sources was changed.

## Judgment calls

- Confirmed mail overrides conflicting legacy dates; otherwise earliest known date wins.
- Never invent historical completion dates or performers. Unknowns are visibly labeled.
- “On or before” remains an upper bound, not an invented exact date.
- Do not invent N/A decisions for the previously optional Revised step.
- Do not guess which unlinked handout belongs to which year/plan.
- Legacy per-plan progress is mapped to the following plan year, not copied into two cycles.
- Every eligible renewal gets a bucket, including older completed/future records;
  deliberately suppressed renewals are excluded, not assigned to a misleading bucket.
- Termination suppresses renewal chasing only; no communication task was closed.
