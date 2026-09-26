---
name: Outbound mail headers and the document guard
description: Why every value that reaches a MIME header must be CRLF-stripped, and what the internal-only guard can and cannot see on a send.
---

The internal-only document guard is handed the recipient lists (To/Cc/Bcc) and
the categories of the attachments. It never sees the raw MIME message.

**Rule:** every value that ends up in a header — subject, display name,
each address, Reply-To — must have CR and LF stripped before the message is
assembled.

**Why:** a newline in a header value does not corrupt the header, it starts a
new one. A subject of `hi\r\nBcc: someone@outside.com` adds a recipient that
the guard was never shown, so an internal-only attachment leaves the company
with the guard reporting the send as allowed. The recipient lists are checked;
the subject is not, which is exactly why it is the field that gets through.

**How to apply:** sanitize inside the MIME builder, not at the route. There is
more than one way into the send helper, and a check at one caller only covers
that caller.

Two related facts about the same path:

- Attachment bytes and the attachment's category must be read from the same
  stored record, by id. A category supplied by the caller means the guard is
  judging a claim rather than the document.
- A file uploaded from the sender's own computer has no stored record, so it
  has no category to read. It is classified by filename alone, which means a
  renamed internal report is not recognised. That is a known and accepted
  gap, not an oversight.
