---
name: Dev server does not reload server code
description: Why a newly added Express route can silently 404 as an HTML page, and what to do about it.
---

# Server code changes need a workflow restart

The dev command runs the server through `tsx` with **no watch flag**, so Vite hot
reloads client files only. Editing server code changes nothing until the
"Start application" workflow is restarted.

## The confusing failure mode

When a newly added `/api/...` route is not registered yet, Vite's catch-all serves
`index.html` instead. That means:

- the request returns **HTTP 200**, not 404
- the body is the SPA shell, roughly 47KB of HTML
- the express log line looks normal, e.g. `GET /api/renewals/14/report 200 in 122ms`

**Why this misleads:** the 200 and the healthy looking log line suggest the route
ran. The giveaway is that the express logger appends `:: {json}` only for
`res.json` responses, so a route that should have returned JSON but shows no `::`
payload almost certainly never matched.

**How to apply:** after any server side edit, restart the workflow before testing.
When an API call unexpectedly returns HTML, check for `id="root"` in the body
before debugging the route logic itself.
