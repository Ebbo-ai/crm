---
name: CRM spreadsheet import
description: Why the workbook import upserts on business keys, how client codes are matched despite inconsistent padding, and why production data cannot be loaded directly.
---

# CRM spreadsheet import

## Corrections arrive in batches, so the import must update in place

The source workbook is built from the plan performance reports, and it is corrected
repeatedly after the first load. Administrative fees are queried with the administrator
and come back over weeks; a single corrected fee touches every tier on the plan.

**Rule:** the import matches on business keys and updates in place. Never insert-only.

- clients: `client_code`
- plans: client + `plan_name` + `coverage_type` + `plan_year`
- rate cards: that plan + `tier_label`

**Why:** an insert-only import turns each correction into dozens of manual edits through
the interface. With upsert, a correction is a revised spreadsheet and one more run.

**How to apply:** any future importer for this data follows the same keys. Running the
same file twice must report everything unchanged; that is the regression test.

## Client codes are spelled two ways in the stored data

The same client exists as `S-020` and as `S-20`, and both spellings are in genuine use
across the stored records. Matching on the literal string silently fails to find the
existing record, tries to insert a second copy, and then dies partway through the run
against the unique client name.

**Rule:** match client codes with the zero padding normalised, and only accept the match
when it resolves to exactly one record. Report every normalised match rather than
performing it silently.

**Why:** the failure surfaces as a client-name uniqueness violation, not as anything to
do with codes, and it strikes mid-write. The symptom points nowhere near the cause.

**How to apply:** any lookup joining external client references to stored clients. Do not
assume either spelling is canonical; both appear in production. Normalise at every
cross-reference, including sheet-to-sheet keys inside a single import.

**Never rewrite the stored code to match an incoming file.** The monthly report import
builds its client lookup on the exact code string, so renaming a client to tidy up the
spelling breaks matching in a subsystem that has nothing to do with the import. Report
the difference and let it be decided deliberately.

## A file owns a column only when the column is present

Corrections arrive as partial workbooks listing the identifying columns and the few
fields that changed. Writing every field the importer knows about would blank out
verified data that the file never mentioned.

**Rule:** column absent from the sheet means never written. Column present with a blank
cell means NULL, because within a supplied column a blank is a real statement. The
exception is a NOT NULL column, where a blank is omitted so new rows take the database
default and existing rows keep what they had.

**Why:** the defaults are the dangerous part. Falling back to "active", "no broker" or a
renewal lead time on a sheet that never carried those columns silently rewrites the book.

**How to apply:** derive the owned-column set from the sheet header row, not from the
list of fields the code knows how to parse.

## Validate before writing, not during

Uniqueness collisions on client name and ambiguous code matches are checked up front
against the whole workbook, before a single row is written, and abort the run.

**Why:** letting the database catch these produces an opaque constraint error halfway
through an import, which is the worst moment to discover it.

## Blanks are stored as NULL, never as zero or a column default

`annual_limit`, the rate card figures and `plan_type` all had defaults or NOT NULL
constraints that would have invented values for genuinely blank cells. A tier can exist
with no published rate; a client can exist with coverage still unconfirmed.

**Why:** these figures render on client-facing documents. A substituted zero is
indistinguishable from a verified zero.

**How to apply:** write every column the workbook owns explicitly, including when the
value is null, so a column default cannot fill the gap. Watch for nullable columns that
still carry a default: those are the ones that fill themselves in silently.

## Structured extraction must fail loudly, not partially

Plan design arrives as prose. Three distinct outcomes, and conflating them is where the
damage happens:

- **Complete** — store the structured values.
- **Annotated** — values are correct but the wording adds something the columns cannot
  hold. Store the values *and* keep the wording.
- **Truncated** — the design has more bands or categories than there are columns. Store
  nothing structured and keep the wording.

**Why:** rendering a four-band design as three bands, or an orthodontia benefit of
unknown eligibility as "not covered", is not an incomplete answer. It is a wrong one,
and it reads as verified on a client document.

**How to apply:** when adding a parser, audit it by re-extracting every number from the
source text and checking that anything not stored in a column is still present in the
notes. A figure that appears in neither is silent loss. That audit is what surfaced a
missing third-band limit column, which had been turning capped bands into unbounded ones.

## Production data cannot be loaded by the agent

Agent access to the production database is read-only, and the publish flow migrates
schema rather than data. Production is therefore loaded by publishing the admin import
screen and running the workbook through the application itself.

**How to apply:** never plan a direct write or migration against production data. Route
it through an application feature the user runs.
