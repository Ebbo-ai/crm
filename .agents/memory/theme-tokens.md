---
name: Theme tokens and colour adoption
description: Why a token-only theme edit can change nothing here, plus the on-fill and gold rules that keep text legible in both themes.
---

# A complete token set does not mean the tokens are used

This project had a full light/dark CSS variable set and a correct Tailwind mapping, yet
almost the entire UI bypassed it with arbitrary-value classes (`text-[#94A3B8]` and
friends) and default-palette classes (`text-amber-600`). Editing the tokens alone moved
almost nothing on screen.

**Why:** arbitrary values compile straight to the literal colour, so they are invisible
to a token change. The palette was effectively duplicated in the components.

**How to apply:** before promising that a theme change will land, grep for arbitrary hex
classes and default-palette classes. If they exist in bulk, retiring them into tokens is
part of the job, not a follow-up. A plain suffix substitution works, because Tailwind
colour utilities share a suffix across `text-`/`bg-`/`border-` and it preserves `hover:`
prefixes and opacity modifiers.

Two things must be excluded from any such sweep: the shadcn primitives directory, which
uses the default palette deliberately on coloured fills, and raw hex inside inline
`style=` strings in the reports page, which drives printed PDF output where the app's
CSS is not loaded and where dark mode never applies.

# Text on a coloured fill needs its own token, never `text-white`

`bg-brand text-white` breaks in dark mode, because the brand fill inverts to a light
blue while the text stays white.

**Why:** a semantic fill token changes lightness between themes. Any text painted on it
must change with it.

**How to apply:** every fill token carries a matching `-foreground`. Use
`bg-success text-success-foreground`, never `text-white`. The foreground tokens are
white in light mode and near-black in dark mode, so one rule covers all of them.

# Gold is a fill colour, not a text colour

The house gold sits around 2.1:1 on a white card, which fails even the 3:1 bar for
graphical objects, so it cannot be used for text OR icons on a light surface.

**How to apply:** for amber-toned *text* use the `warning` family, which is darkened
specifically to clear 4.5:1. Gold as text is legal only on a brand fill, and only via
the dedicated `gold-on` token, which is a light amber in light mode and a deep amber in
dark mode because the brand fill itself inverts. Gold as a background always pairs with
`text-gold-foreground`, which is dark in both themes.

# Raise type through the Tailwind fontSize scale, not an html font-size

This app leans almost entirely on `text-xs` and `text-sm`, so setting a root font size
barely moves body copy.

**How to apply:** override the `fontSize` scale in `tailwind.config.ts`. `text-sm` is
the de facto body size and must land around 15px; `text-xs` is the dense-table size and
is floored at 13px. Arbitrary sizes below that floor (`text-[10px]`, `text-[9px]`) have
been swept out and must not come back.
