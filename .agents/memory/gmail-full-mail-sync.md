---
name: Gmail full-mailbox sync (Mail feature)
description: Read-only full-mail (not just has:attachment) sync into gmail_threads/gmail_messages/gmail_attachments — pagination gotcha, classification, private flag.
---

Separate from the older has:attachment-only `gmailIngestion.ts`/`gmail_import_state` row (keyed by mailbox). The new full sync (`server/gmailFullSync.ts`) tracks its own state under `${mailbox}#full` in the same `gmail_import_state` table so neither importer clobbers the other's progress marker. The old importer is left in place for history but is no longer scheduled — the full sync is a superset (it also files real attachments).

**Pagination gotcha (hit and fixed once):** a message-list sync bounded by "N messages scanned per run" must count *duplicates* (already-imported messages) too if it wants a stable resume cursor — but if the cap is checked mid-page and the run stops without finishing that page, the Gmail pageToken can only resume at the *next* page, permanently skipping whatever was left unprocessed in the interrupted page. Fix: always finish processing a full page before checking the cap again (allow the run to overrun the cap by up to one page), and persist the real `nextPageToken` (repurposing `gmail_import_state.lastProcessedInternalDate` as a token string, not a date) so each run advances monotonically instead of re-scanning the same page and making zero net progress once the imported backlog exceeds one run's cap.

**Why:** the mailbox is scanned as `after:<12-months-ago-epoch>` with no upper bound (full mail, not has:attachment-restricted), so a naive "stop this run once N messages seen" easily stalls on a large backlog.

**Classification:** thread-level `businessStatus` (MATCHED/UNASSIGNED/NOT_BUSINESS) is decided once per touched thread at the end of a sync run, not per message — existing `matchEmailToClients` heuristic first, then `classifyMailRelevance` (Claude, defaults to business=true when unsure) only for threads with no client match.

**Embedded-image exclusion:** attachments are skipped from client-document filing when `mimeType` is image/* and either under ~30KB or the filename matches icon/logo/imageNNN/~WRD/district-logo patterns — this is what the original has:attachment-only backfill got wrong (it filed ~50+ signature logos as real documents; cleaned up via `storage.cleanupEmbeddedImageDocuments()`, run once at startup, idempotent by name pattern).

**Private flag:** implemented at thread level (`gmailThreads.isPrivate`), not per-message — matches the CRM's thread-as-navigation-unit convention. Enforced in every read path: `searchGmailThreads`, `getGmailInboxCounts`, and the thread-detail route (403 for non-admin on a private thread).
