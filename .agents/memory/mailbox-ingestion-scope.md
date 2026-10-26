---
name: Mailbox ingestion scope
description: Kim-only ingestion; retain Steve and clientservice connections for sending
---
Only Kim's mailbox should ingest mail. Steve's and clientservice's polling,
backfills and recovery must remain disabled even after reconnecting or seeding.
Preserve their stored mail, tasks, communications and documents.

**Why:** The user said Kim will be using the CRM; Steve retains login access
to see what is happening. Disabling ingestion must not break sending.

**How to apply:** Treat ingestion eligibility separately from OAuth connection
status and sending identities. Do not revoke those connections or delete data.
