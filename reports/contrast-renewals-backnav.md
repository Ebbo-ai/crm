# SimpleSpot: three changes, verification report

Generated 31 August 2026.

---

## 1. Contrast and type size

### What was actually wrong

The theme already had a complete light and dark token set and a correct Tailwind
mapping. Almost nothing used it. There were roughly 971 hardcoded hex classes across 31
files, plus a second layer of Tailwind default-palette classes. `text-[#94A3B8]` alone
appeared 464 times at 2.56:1 on white.

So a token-only edit would have changed almost nothing on screen. The hardcoded palette
had to be retired into tokens first, then the tokens fixed.

### Surface tokens, before and after (light mode)

| Token | Role | Before | After |
|---|---|---|---|
| `background` | page behind the cards | `210 20% 96%` | `210 24% 91%` |
| `card` / `popover` | card and panel fill | white | white |
| `muted` | table header row | `210 20% 93%` | `210 26% 87%` |
| `accent` | hovered table row | `210 20% 95%` | `210 34% 93%` |
| `secondary` | secondary fill | `210 20% 94%` | `210 22% 89%` |
| `border` | all rules and card edges | `210 16% 88%` | `210 20% 74%` |
| `input` | form field edge | `210 16% 82%` | `210 22% 62%` |
| `foreground` | body text | `210 24% 16%` | `210 30% 12%` |
| `muted-foreground` | secondary text | `210 14% 46%` | `210 20% 34%` |

### Surface separation, before and after

These are the ratios that decide whether one layer reads as distinct from the next.

| Pair | Before | After |
|---|---|---|
| page vs card | 1.04 | 1.23 |
| card vs table header | 1.20 | 1.36 |
| card vs hovered row | 1.15 | 1.18 |
| card vs border | 1.16 | 1.92 |
| card vs input edge | 1.73 | 2.76 |

Card vs border going from 1.16 to 1.92 is the one that matters most. At 1.16 a border is
not visible as an edge at all.

### Body text, before and after

The token values barely moved because they already passed. The colours actually painted
on screen moved a great deal, because they were hardcoded and bypassing the tokens.

| Colour in use | Where | Before | After |
|---|---|---|---|
| `#94A3B8` | secondary text, 464 uses | 2.56 | 7.46 |
| `#64748B` | secondary text | 4.76 | 7.46 |
| `#2E86C1` | links and accents | 3.97 | 6.76 |
| `#F5A623` as text | warnings | 2.03 | 7.00 |
| `#22C55E` as text | success states | 2.28 | 6.63 |
| `#EF4444` as text | error states | 3.76 | 7.11 |
| `#1A5276` | headings | 8.36 | 8.89 |
| `text-amber-600` | warnings | 3.19 | 7.00 |
| `text-green-600` | success | 3.30 | 6.63 |
| `border-gray-100` | 31 uses | 1.10 | 1.92 |

`border-gray-100` at 1.10:1 was effectively an invisible border.

### Type scale

Raised through the Tailwind `fontSize` scale rather than the root font size, because the
app leans almost entirely on `text-xs` and `text-sm`, so a root change would have moved
very little.

| Class | Before | After | Used for |
|---|---|---|---|
| `text-xs` | 12px | 13px | dense tables, the floor |
| `text-sm` | 14px | 15px | body copy |
| `text-base` | 16px | 17px | |
| `text-lg` | 18px | 19px | |
| `text-xl` | 20px | 21px | |
| `text-2xl` | 24px | 25px | |
| `text-3xl` | 30px | 31px | |
| `text-4xl` | 36px | 37px | |

Arbitrary sizes below the floor were lifted: every `text-[9px]`, `text-[10px]`,
`text-[11px]` and `text-[12px]` is now `text-xs`.

### Final state

Zero hardcoded hex classes and zero sub-13px arbitrary sizes remain outside the shadcn
primitives directory and the print output path. Every token pairing across ten surfaces
and eleven text colours, in both light and dark mode, clears 4.5:1. So does every piece
of text sitting on a coloured fill.

Two exclusions, both deliberate. The shadcn primitives use the default palette on
coloured fills, for example light text on a red toast. And raw hex inside inline `style=`
strings on the reports page drives printed PDF output, where the app CSS is not loaded
and dark mode never applies.

---

## 2. Dashboard renewals, three boxes

### A note on where the data comes from

Three parallel renewal systems existed. The `renewals` table, which the client record
and the alerts endpoint read. The dashboard's own plan-level logic derived from
`plans.effectiveDate` and `plans.isRenewalComplete`. And the older per-plan progress
table.

All three boxes are now built on the `renewals` table plus `clients.anniversaryDate`,
and the plan-level derivation is retired from the dashboard. The dashboard and the
client record now agree about the same client.

### The rules as implemented

`days_out = anniversary - today`. Complete means the pipeline reached `EMAILED_TO_90D`.
All three boxes come from a single shared classifier that walks clients once, so they
are mutually exclusive by construction.

- **Upcoming**: not complete, no pipeline work started, `0 <= days_out <= 30`. Sorted
  ascending by anniversary.
- **Current**: any pipeline step set and not complete, or `days_out < 0` and not
  complete. Sorted ascending by anniversary.
- **Complete**: complete, and `today <= anniversary + 45`. Sorted descending by
  completion date.

LATE appears in the Current box only: not yet reached Sent, and `days_out < 14`. The
threshold is one named constant, and the badge is a text badge, not colour alone. The
late count shows in the Current box header.

### Live counts right now

| Box | Count |
|---|---|
| Upcoming | 3 |
| Current | 0 |
| Complete | 0 |
| Late (within Current) | 0 |

The three in Upcoming: S-27 Florida Oral and Facial, S-459 Grand County Schools,
S-174 Red Lake Public School. All at anniversary 1 September 2026, one day out, no
pipeline work started.

Current and Complete are empty because the database holds 7 renewal rows and not one has
a pipeline step set. Nothing has been started, so nothing can be in progress and nothing
can be complete. That is the data, not the logic.

### Boundary proof

Because live data cannot exercise the rules, the classifier was run directly against
synthetic cases. Every rule holds:

| Case | Expected | Result |
|---|---|---|
| unstarted, 30 days out | Upcoming | Upcoming |
| unstarted, 0 days out | Upcoming | Upcoming |
| unstarted, 31 days out | nowhere | nowhere |
| unstarted, 45 days out | nowhere | nowhere |
| `REQUESTED`, 13 days out | Current, LATE | Current, LATE |
| `PROCESSED`, 13 days out | Current, LATE | Current, LATE |
| unstarted, 5 days overdue | Current, LATE | Current, LATE |
| `SENT`, 13 days out | Current, not late | Current, not late |
| `ACCEPTED`, 13 days out | Current, not late | Current, not late |
| `REQUESTED`, exactly 14 days | Current, not late | Current, not late |
| complete, 45 days past | Complete | Complete |
| complete, 46 days past | nowhere | nowhere |

Late count across that set: 3. No client landed in two boxes. The classifier throws if
one ever does, so a double assignment cannot pass silently.

### One thing needs your ruling

There is a genuine conflict between two of the rules as written.

Box 1 is defined as unstarted and 0 to 30 days out. LATE is defined as reaching 14 days
out without having sent, and is explicitly scoped to Box 2 only.

So a renewal that nobody has started, sitting at 10 days out, satisfies the late
condition but sits in Upcoming with no LATE badge, because Box 1 does not carry the
badge. It is exactly the case you would most want flagged, and right now it is the
quietest row on the screen.

It is built as written rather than quietly changed, because moving unstarted overdue
renewals into Current is a decision about what the boxes mean, not a bug fix.

Three ways to resolve it, whichever you prefer:

1. Leave it. Unstarted work is Upcoming until someone touches it, and the 30 day window
   is itself the warning.
2. Show the LATE badge in Upcoming too, keeping bucket membership exactly as it is.
3. Move unstarted renewals inside 14 days into Current, so Current means "needs action
   now" regardless of whether anyone has started.

---

## 3. Back navigation

One shared control, rendered once in the app layout immediately above the page content,
so the position is identical everywhere. Hidden on the dashboard and login. The two
bespoke back links that previously existed on the client detail and client form pages
were removed.

### Route coverage

All 17 declared routes were checked against the parent-route map. Zero unmatched.

| Route | Back goes to |
|---|---|
| `/` | control hidden |
| `/dashboard` | control hidden |
| `/login` | control hidden |
| `/clients` | `/dashboard` |
| `/clients/:id` | `/clients` |
| `/clients/:id/edit` | `/clients/:id` |
| `/clients/new` | `/clients` |
| `/general` | `/dashboard` |
| `/inbox` | `/dashboard` |
| `/issues` | `/dashboard` |
| `/ppr-batch` | `/dashboard` |
| `/ppr-import` | `/dashboard` |
| `/renewal-alerts` | `/dashboard` |
| `/reports` | `/dashboard` |
| `/settings/crm-import` | `/dashboard` |
| `/settings/data-reset` | `/dashboard` |
| `/settings/users` | `/dashboard` |

Anything unrecognised falls back to `/dashboard`, so the control can never navigate out
of the app.

### How it knows whether real history exists

The control uses browser history when there is somewhere in the app to go back to, and
falls back to the parent route otherwise. Knowing which is the hard part.

The depth of each history entry is stamped onto the entry itself. A push goes one level
deeper. A replace inherits the depth of the entry it overwrites. The first entry of a
session is depth 0, whether that is the dashboard or a deep link pasted into a new tab.
Depth 0 means nothing of ours is behind us, which triggers the parent fallback.

Two earlier approaches were wrong and were discarded. A counter cannot work, because
Back and Forward both fire the same event with no direction information, so the count
drifts the first time someone presses Forward. Stamping from a React effect cannot work
either, because a replace wipes the stamp before the effect sees it, and because
navigating to the path you are already on does not re-render.

### Sequence proof

Simulated against real browser history semantics:

| Sequence | Result |
|---|---|
| deep link to `/clients/new`, Back | falls back to `/clients`, then to `/dashboard`, never leaves the app |
| dashboard, issues, client, Back, Forward | depth reads 2 correctly after Forward, Back lands on `/issues` |
| push the same path twice, Back | depth 2 then 1, Back is a real history move, no false fallback |
| three pushes, three Backs | walks back to the dashboard one level at a time |
| deep link three levels down | falls back parent by parent to the dashboard |
| replace-navigation mid-session | keeps depth 1, does not gain a level |

---

## Verification summary

- Typecheck holds at the pre-existing 71-error baseline. All 71 are the known
  `string | string[]` query-parameter errors on the server. Zero errors in any file
  touched.
- Browser console is clean. The errors visible earlier were transient states during hot
  reload, and nothing has logged an error since the final change.
- A pre-existing defect was fixed along the way: two dashboard tables wrapped a table row
  in a link, which threw an invalid hook call and a DOM nesting error on every dashboard
  load. Both are now click handlers on the row.
- The screenshot tool cannot get past the login wall, so none of this is visually
  confirmed on screen. Everything above is measured or simulated, not seen.
