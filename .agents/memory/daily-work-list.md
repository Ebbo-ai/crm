---
name: Daily work list rules
description: Approved separation of accepted work, renewal actions and fresh suggestions
---
The daily digest and Today view distinguish accepted TODOs from AI suggestions.
Older unreviewed email suggestions stay in triage, never become daily obligations
just because they remain open. Repeated asks attach to existing open work rather
than generating a new task. Terminated clients may still need run-out service.

**Why:** Steve said Kim needs a usable daily list, not every unreviewed extraction.
He prohibited closing or archiving production tasks as part of this change.

**How to apply:** Keep historical tasks intact; separate read-time presentation from
cleanup. Preserve source-message links and human resolution notes. Email links must
not mutate state on GET, because mail scanners may follow them. Use authenticated
POST actions in Today.

Renewal work is owned by step: Steve owns Processed and requested Revised; Kim owns
every other step and handouts. Steve gets a distinct-renewal count waiting on Kim.
Only Current/LATE renewals appear. Earlier unrecorded steps are passed once a later
step is done; Revised appears only when explicitly requested. When the anniversary
is more than 30 days past and Emailed to 90 Degree is DONE, missing handouts are
displayed as "Not tracked (before CRM)" and excluded from the daily work list.
Uploads remain available.

Handout lines require an explicitly DONE or NA Accepted step. Earlier steps being
implicitly passed by later completion is not sufficient for this gate.
**Why:** Steve said employee handouts are produced only after the client accepts;
they must not appear alongside an open Processed or Accepted step.
**How to apply:** Apply this gate to the shared digest/Today calculation before
adding any handout lines; retain the existing historical-handout exclusion.

**Why:** Steve corrected the shared queue and historical gaps that created false work.
He said, "She asks me to run a renewal or produce an employee handout, for example.
I give it to her with the email that claude has drafted and she presses send."

**How to apply:** Derive passed/untracked display without inventing completion dates
or overwriting historical records. Count renewals waiting on Kim once even if there
are several handouts. Preserve the existing dashboard bucket classifier.
