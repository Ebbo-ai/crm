---
name: Gmail API bulk/analytical calls
description: Rate-limit and endpoint behavior when calling the Gmail API in bulk from outside the app (e.g. for a one-off analysis), not through the app's own sync code.
---

- Real Gmail REST endpoints for this project's needs: `GET /gmail/v1/users/me/threads` (list, id+snippet only), `GET /gmail/v1/users/me/threads/{id}?format=metadata&metadataHeaders=X` (per-thread header fetch), `GET /gmail/v1/users/me/messages` (list). There is no `threads:search` fused endpoint in the real Gmail API — a comment in `server/gmail.ts` describing `searchThreadsWithAttachments` as calling one shows a URL path that 404s; don't trust that comment as evidence the endpoint exists without checking the actual response.
- Per-thread/per-message metadata fetches at even moderate concurrency (~25 parallel) hit heavy 429/403 throttling — the majority of calls failed outright with no retry. Dropping to ~6 concurrent with exponential backoff retry made the same volume succeed with zero hard failures, just many retried-and-succeeded calls.
- **Why:** a naive concurrent loop over thousands of thread/message IDs (e.g. for a one-off domain/sender analysis across a whole label) will silently produce a mostly-empty, misleading result if failures aren't counted and retried — the error rate isn't visible unless you log it.
- **How to apply:** for any bulk read across many Gmail messages/threads done outside the app's own paced sync path, use low concurrency (~5-8) with retry+backoff on 429/403, and log/report the retry count so a broken run is visible rather than silently undercounting.
