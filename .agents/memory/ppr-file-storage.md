---
name: PPR file storage and the monthly zip import
description: Where PPR documents live, and why the Dashboard zip import must both read metrics and file documents.
---

# PPR documents are stored in Object Storage, never on disk

Anything written under `uploads/` is gone on the next publish — a deploy gets a
fresh filesystem while the database rows survive, so disk-backed file paths turn
into rows pointing at nothing. Any user-visible uploaded file (PPRs, Gmail
attachments) belongs in Object Storage.

**Why:** a month of PPR uploads was found pointing at paths wiped by a redeploy.

**How to apply:** when adding an upload path, use memory multer plus the storage
helper, and keep a filesystem fallback on *read* only for rows written before the
migration. Deterministic keys (client + file name) mean a re-upload overwrites
rather than orphaning; update the DB row before retiring an old object, so a
failed write never leaves a row aimed at a deleted file.

# The monthly zip import does two separate jobs

The Dashboard "Import Monthly PPRs" zip is the only place a whole month arrives
at once, and it has two obligations per entry: extract the loss-ratio figures
from spreadsheets, and file every document (PDF *and* spreadsheet) onto the
client's PPR tab. It shipped doing only the first, so it reported a successful
import while no document ever reached a client, and PDFs were filtered out
before they were even counted as skipped.

**Why:** metrics and documents are separate tables; "imported" measured only the
metrics half, so the failure was invisible from the UI.

**How to apply:** a count shown to the user must be traceable to rows actually
written. Report filed documents and parsed spreadsheets separately rather than
one blended "imported" number.

# Report period for a PDF

A spreadsheet carries its period in the monthly rows; a PDF carries none. Order
of inference for a PDF: the `Sxx_Name_Mon2026.pdf` filename convention, then the
period its client's spreadsheet in the same zip resolved to, and if that client
had spreadsheets for more than one period, skip it rather than guess. Single
files for one client are uploaded from that client's PPR tab, where the user
picks the period explicitly — roughly 5-10% of months need that.
