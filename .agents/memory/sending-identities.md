---
name: Per-user sending identities
description: How outbound CRM email (From address permissions, signatures, Reply-To, attribution) is modeled and enforced.
---

Outbound mail from the CRM goes through `sending_identities` (the mailbox, e.g.
clientservice@simple.us, kim.anderson@simple.us — each with its own editable
signature) and `user_sending_identities` (a plain join table saying which
users may send as which identity). The permission check itself lives in that
join table, not in an if/else on name or role, so a new user or address never
needs a code change — only a row.

**Why:** the business rule ("Kim may send as herself or the shared client
service address; Steve may send as all three") is data the two people
involved edit over time (new hires, new shared inboxes), not a fact about the
code.

**How to apply:** every send goes through POST /api/communications/send,
which re-checks `userMaySendAs(userId, identityEmail)` server-side regardless
of what the client sent — never trust a dropdown alone. The `communications`
table doubles as the outbound log: `direction` distinguishes in/out,
`senderEmail`/`senderName` hold the identity used, and `sentByUserId` /
`sentByUserName` hold the actual logged-in sender — kept separate because
covering for someone means those two differ. An outbound row is
auto-resolved on creation (status RESOLVED) so it never shows up in the
ACTIVE triage feed.

Reply-To is set to clientservice@simple.us whenever the identity used isn't
the sender's own login address (covering for someone, or sending as the
shared box itself is already that address). A BCC to the identity's own
mailbox rides along on every send: Mailgun's HTTP API leaves no Sent-folder
copy in Gmail the way sending through Gmail's own relay would, so without the
BCC a shared identity would have zero record of its own outbound mail once
Gmail sync starts reading that mailbox. This does not stitch Gmail
In-Reply-To/References threading — a message sent via Mailgun has no Gmail
thread of its own for a reply to attach to, so a reply to a Mailgun-sent
message will surface as a new thread in Gmail sync, not nested under the
original. The CRM's own communication log is the reliable record; Gmail's
thread view is not, for anything sent this way.
