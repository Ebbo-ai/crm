---
name: Internal-only documents and the recipient guard
description: Which document categories may never leave the company, where the refusal is enforced, and the recipient-parsing rule that keeps it honest.
---

# Internal-only documents

Some document categories carry fee detail that never goes to a client or a broker: the administrative fee breakdown (the client sees one all-in figure) and what the broker is paid. The category list is shared between server and UI so the badge and the refusal cannot drift apart.

**Why:** the breakdown is the company's own pricing. A single mis-sent attachment hands it to the party negotiating against it.

**How to apply:** treat the category as the unit of restriction. Resist per-document exceptions — an exception is something a person grants under pressure at the moment of sending.

A category holding two audiences cannot be protected. The app-generated renewal report and the client-facing renewal proposal shared one category until the report was given its own; the guard decides by category, so one of the two was always filed wrongly. When a generated document is restricted, give it its own category and have the generator file it — never rely on someone setting it.

## Classification must not take the sender's word

Filename-pattern classification decides the category of mail attachments, and the category decides who may receive the document. So a pattern that can move a document *into* a restricted category is matched against the filename alone, anchored, and only against filenames this app itself emits — never against the email subject, which is written by whoever sent the mail.

**Why:** an unanchored pattern searching filename + subject let a subject line quoting a report filename reclassify an unrelated attachment, and a loose "renewal report" match would file a broker's document as internal-only — blocking a legitimate send, the mirror-image failure.

**How to apply:** if this app writes the same document under two filenames (a download name and a saved name with a timestamp), the pattern has to cover both, or a copy that comes back in by mail lands in the permissive category.

## Enum changes have two branches

The document category enum is added to by a startup `ADD VALUE IF NOT EXISTS`, but an older conditional branch still rebuilds the whole type from a literal list. A new label must be added to **both**, or a lagging database drops a value the deploy-time schema diff already added, and the cast takes any row filed under it with it.

## The guard sits in two places, deliberately

On the request (so the refusal can name the person and answer with something fixable) and inside the send helpers where the message is built (so any future send path inherits it without having to remember).

**Why:** the control was written before the capability existed. Nothing could attach a document to outgoing mail when it went in; the attach flow arrives later, and a guard added afterwards is a guard that ships late.

**How to apply:** when attachment support lands, the attached bytes and the category checked must come from the same server-resolved document record. A caller-declared category is a bypass with extra steps.

## Recipient parsing fails closed, and one entry can hold many recipients

A recipient array entry is not one recipient. An address list pasted into a single box arrives as one string inside the array, and reading only its last address lets an outsider ride alongside an internal recipient unnoticed. Split on commas and semicolons outside quotes and angle brackets, then check every address-shaped token in each piece. Anything unreadable counts as outside the company.

**Why:** this exact case passed the guard in review — `["Jane <jane@broker.example>, Kim <kim@ourdomain>"]` was allowed while the mail header carried both.

**How to apply:** any new recipient field (Cc, Bcc, a reply path, a bulk send) goes through the same collector. Bcc is the field that gets missed, so it is named in the refusal message like the others.
