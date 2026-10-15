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
POST actions in Today. Renewal records currently have no assignee, so show a shared
queue rather than inventing per-person ownership.
