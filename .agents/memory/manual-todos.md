---
name: Manual to-dos and multi-client tasks
description: Why a task can cover several clients or none at all, and what the flat client_id column now means.
---

## A task's clients live in the join table, not on the task

A task is attached to zero, one, or many clients through the join table. The
flat `client_id` column on the task is a **mirror of the first attached client**,
kept only so older read paths keep working. Never treat it as the truth and
never write it alone: writing clients without updating the mirror, or the
mirror without the join rows, splits the record.

**Why:** the email path used to fake multi-client by inserting one duplicate
task row per matched client, so a single job ("send the renewal to Annette for
both groups") appeared twice and had to be resolved twice. Kim resolved one
copy, the other sat there looking outstanding, and the list stopped being
believable. One task, many clients, resolved once.

**How to apply:** any new read that shows tasks on a client record must join
through the join table. Any new write must go through the storage helpers that
write both sides together.

## A task can exist with no email behind it

`communication_id` is nullable. A phone call or a hallway conversation has no
message to hang off, and inventing a synthetic communication to satisfy the
foreign key would have put fake emails in the mail history. Any code that
groups tasks by their communication must tolerate a null key.

## "General" means no client attached, whatever the source

General is not a flag and not a special client record. It is the absence of an
attachment. That definition is deliberate: an email that matched nothing and a
note Kim typed about ID card design both belong to the business rather than to
an account, and both should read the same way on the list.

## Never merge duplicate history that carries a human note

The startup migration collapses the old duplicated email tasks onto one shared
task, but only for groups where every copy is still unresolved and none carries
a resolution note.

**Why:** resolution notes are permanent by design and nothing in this app is
deletable. Merging two resolved copies would mean choosing which person's
account of what happened survives, which is exactly the kind of silent data
loss the resolution note exists to prevent. Machine-written duplicates of each
other are safe to collapse; anything a person typed is not.

**How to apply:** the same rule governs any future backfill that consolidates
records. Collapse only what a machine wrote, and leave any group where a human
has already acted.
