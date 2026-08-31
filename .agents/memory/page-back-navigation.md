---
name: Shared back control and history depth
description: Why in-app history depth rides on the history entry rather than a module counter, and where the control is rendered.
---

# Back depth lives on the history entry, not in a counter

The shared back control needs to know whether there is any in-app history behind the
current page, so that it can fall back to a logical parent route instead of navigating
the user out of the app.

**Why:** a module-level counter cannot do this. Back and Forward both fire `popstate`
with no direction information, so a counter that decrements on every `popstate` drifts
the first time the user presses Forward. `window.history.length` is worse: it counts
entries from other sites and will happily send the user off the app.

**How to apply:** stamp a depth number into `window.history.state` on each entry. An
entry that already carries a number is one we have visited, so read it; an unstamped
entry is either the first of the session (depth 0) or a fresh push (previous depth + 1).
Back, Forward and reload then all restore the correct value with no bookkeeping. Depth 0
means "nothing of ours behind us", which is exactly the deep-link / new-tab / refresh
case that must use the parent-route fallback.

Also listen to `popstate` directly: a Back that lands on the same path does not change
the router's location, so a location-keyed effect will not fire.

# It is rendered once in the app layout

Every authenticated page is wrapped in the shared layout, so the control is rendered
there, immediately above the layout children, and hidden on the dashboard routes and
login.

**Why:** this is what makes the position consistent for free and avoids editing every
page. Pages must not add their own back affordance; two bespoke ones were removed when
the shared control landed.
