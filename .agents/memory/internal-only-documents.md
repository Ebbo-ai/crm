---
name: Internal-only documents and the recipient guard
description: Which document categories may never leave the company, where the refusal is enforced, and the recipient-parsing rule that keeps it honest.
---

# Internal-only documents

Some document categories carry fee detail that never goes to a client or a broker: the administrative fee breakdown (the client sees one all-in figure) and what the broker is paid. The category list is shared between server and UI so the badge and the refusal cannot drift apart.

**Why:** the breakdown is the company's own pricing. A single mis-sent attachment hands it to the party negotiating against it.

**How to apply:** treat the category as the unit of restriction. Resist per-document exceptions — an exception is something a person grants under pressure at the moment of sending.

## The guard sits in two places, deliberately

On the request (so the refusal can name the person and answer with something fixable) and inside the send helpers where the message is built (so any future send path inherits it without having to remember).

**Why:** the control was written before the capability existed. Nothing could attach a document to outgoing mail when it went in; the attach flow arrives later, and a guard added afterwards is a guard that ships late.

**How to apply:** when attachment support lands, the attached bytes and the category checked must come from the same server-resolved document record. A caller-declared category is a bypass with extra steps.

## Recipient parsing fails closed, and one entry can hold many recipients

A recipient array entry is not one recipient. An address list pasted into a single box arrives as one string inside the array, and reading only its last address lets an outsider ride alongside an internal recipient unnoticed. Split on commas and semicolons outside quotes and angle brackets, then check every address-shaped token in each piece. Anything unreadable counts as outside the company.

**Why:** this exact case passed the guard in review — `["Jane <jane@broker.example>, Kim <kim@ourdomain>"]` was allowed while the mail header carried both.

**How to apply:** any new recipient field (Cc, Bcc, a reply path, a bulk send) goes through the same collector. Bcc is the field that gets missed, so it is named in the refusal message like the others.
