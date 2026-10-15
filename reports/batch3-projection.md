# Batch 3: read-only production projection

## Verification and scope

- Dev checks passed for the three rendered sections, 15-suggestion cap and overflow count,
  exclusion of older/repeated suggestions, repeated-thread attachment to one task,
  invalid-date storage as NULL with a review flag, termination filtering, run-out
  allowance, Accept/Dismiss transitions and stale-action rejection.
- Production build passes. Full TypeScript check still has 91 errors, matching the
  earlier baseline. App startup was checked; signed-in Today UI was not browser-verified.
- No email was sent as a test. No production task was closed, archived, or edited.
- New task metadata columns were added in dev only. Publishing must apply those
  schema additions; batch 3 needs no existing-task data migration.
- Main files: server/digest.ts, server/daily-work.ts, server/email-task-intake.ts,
  server/gmailFullSync.ts, server/claude.ts, server/storage.ts, server/routes.ts,
  shared/daily-work.ts, shared/schema.ts, client/src/pages/today.tsx,
  client/src/App.tsx, client/src/components/app-sidebar.tsx,
  client/src/components/gmail-triage-feed.tsx.
- Verification/projection scripts: scripts/verify-daily-work.ts and
  scripts/project-daily-work.ts.
- Judgment calls: undated accepted tasks stay visible; renewal work is shared because
  renewals have no assignee; ambiguous service/claims/run-out work is not suppressed.
  Dismiss records a permanent standard note. Legacy manually forwarded email lacks
  a trustworthy source sent date, so newly extracted deadlines there require review.

For October 16, 2026, 7:30 AM Eastern. Uses the October 15 snapshot, the previous recorded digest date (October 15 at 7:30 AM Eastern), and the pending batch-2 renewal migration projection. Assumes publication and that migration; future mail, accepts, dismissals and renewal changes are unknown. No production data was changed.

Renewal work has no assignee and is shared in both lists. Requested/Processed/Sent are due 14 days before anniversary; later steps/handouts by anniversary. Undated accepted to-dos remain visible. Existing task dates are preserved; the new date guard applies to future extraction. Email links open the matching Today row; actions require an authenticated POST, never a GET that a mail scanner can follow.

## Kim Anderson

Total open: 1066. My to-dos: 10; renewal lines: 44; new email displayed: 15; more in triage: 3.

### My to-dos — first ten

1. **General:** Steve: Colquit updated new group sheet — no due date.
2. **Red Lake Public School:** Steve:  Issue with renewal dates, example Red Lake Public Schools — no due date.
3. **Simple:** STeve:  Need a renewal form to provide to 90 degrees that shows admin fee breakdown — no due date.
4. **Loudon County Board of Education:** Steve:  PPR's for the past 2 years for Loudon County.  Where can i access these reports. — no due date.
5. **Simple:** Steve:  Reformat the PPR's that I have sent in 2 emails into the new format and return to my attention — no due date.
6. **General:** Steve: need to be able to remove or delete a broker.  Currently only able to change and select new broker. — no due date.
7. **Bankers Bank of the West:** Steve: Renewal needed for Bankers Bank of the West by 9/14/2026 — no due date.
8. **Belgrade Brooten Elrosa PS #2364:** Steve: Renewal requested for Belgrade Brooten Elrosa  S483 — no due date.
9. **Windsor HR Services, Inc.:** Steve: Windsor HR Renewal Due — no due date.
10. **Loudon County Board of Education:** Steve:  Revised Loudon Dental Renewal needed — no due date.

### Renewal steps — first ten

1. **Florida Oral & Facial:** SENT — due 2026-08-18.
2. **Florida Oral & Facial:** Employee handout: DENTAL_ONLY Standard — due 2026-09-01.
3. **Grand County Schools:** REVISED — due 2026-09-01.
4. **Grand County Schools:** Employee handout: DENTAL_ONLY Standard — due 2026-09-01.
5. **Red Lake Public School:** REVISED — due 2026-09-01.
6. **Red Lake Public School:** Employee handout: DENTAL_ONLY Standard — due 2026-09-01.
7. **Saturn of St. Paul:** REQUESTED — due 2026-09-17.
8. **Saturn of St. Paul:** Employee handout: DENTAL_ONLY Standard — due 2026-10-01.
9. **Alamosa State Bank:** REVISED — due 2026-11-01.
10. **Alamosa State Bank:** Employee handout: DENTAL_ONLY Standard — due 2026-11-01.

### New from email — first ten

1. **Simple:** Review Unity Care PPR now available on portal — no due date.
2. **Minnwest Corporation:** Keep Jennifer Blount updated on Minnwest Corporation (S160) 1/1/2027 dental renewal as more information becomes available — no due date.
3. **Simple:** Check records to confirm Loudon broker said they didn't want to sign another form and are covering the increase for employees — no due date.
4. **Simple:** Respond to Steve about whether he should send the WDA email to 90DB that was previously discussed — no due date.
5. **Simple:** Steve will follow up with Minnwest on Monday (one last attempt) - no action needed from recipient — due 2025-01-13.
6. **Simple:** Review RAs and RTs for Gordon, Murray, VA, and possibly Thomas/VPU when Steve delivers them before lunch — no due date.
7. **Simple:** Explain to Jennifer Blount why commission/admin fee was not increased on Alamosa State Bank renewal and provide documentation if this was an intentional exception — no due date.
8. **Simple:** Send short reply to Allison from Kim: disregard 10/14 note, plan stays member-only until WDA confirms change in writing — no due date.
9. **Simple:** Ask Abby/WDA directly: keep member-only rule for 1/1/2027 or open plan to any licensed dentist? — due 2027-01-01.
10. **Simple:** If WDA keeps rule: work with 90DB on alternative matching methods (NPI, name/license) or pend-and-confirm process for claims — no due date.

## Steve Schultz

Total open: 278. My to-dos: 0; renewal lines: 44; new email displayed: 5; more in triage: 0.

### My to-dos — first ten

None.


### Renewal steps — first ten

1. **Florida Oral & Facial:** SENT — due 2026-08-18.
2. **Florida Oral & Facial:** Employee handout: DENTAL_ONLY Standard — due 2026-09-01.
3. **Grand County Schools:** REVISED — due 2026-09-01.
4. **Grand County Schools:** Employee handout: DENTAL_ONLY Standard — due 2026-09-01.
5. **Red Lake Public School:** REVISED — due 2026-09-01.
6. **Red Lake Public School:** Employee handout: DENTAL_ONLY Standard — due 2026-09-01.
7. **Saturn of St. Paul:** REQUESTED — due 2026-09-17.
8. **Saturn of St. Paul:** Employee handout: DENTAL_ONLY Standard — due 2026-10-01.
9. **Alamosa State Bank:** REVISED — due 2026-11-01.
10. **Alamosa State Bank:** Employee handout: DENTAL_ONLY Standard — due 2026-11-01.

### New from email — first ten

1. **Simple, Wisconsin Dental Association:** Provide updated WDA member list effective January 1, 2027 — no due date.
2. **Simple:** Optional: Register for FAIR Health Atlas webinar on November 12, 1-2 PM ET if relevant to business operations — due 2020-11-12.
3. **Simple:** Notify sender this email was misdirected to Simple Benefits (not the intended recipient Steve) — no due date.
4. **Simple:** Remove Simple Benefits from Patricia's Spiritwear mailing list or mark as spam — no due date.
5. **Simple, Wisconsin Dental Association:** Note WDA's monthly member listing schedule (sent at beginning of each month by Lisa) for tracking and reconciliation purposes — no due date.

