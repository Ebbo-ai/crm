---
name: Rating Engine Python service
description: Architecture and setup decisions for the internal Python PDF/rating service.
---

## Rule
The rating engine lives in `rating_engine/` as a Flask service on `127.0.0.1:5001`. It is internal-only — never exposed to the browser. The Node backend calls it via HTTP on localhost.

**Why:** Keeps Python actuarial/PDF logic separate from the Node CMS, avoids a second deployment, shares the same Repl.

## How to apply
- New rating/PDF endpoints go in `rating_engine/main.py`.
- The workflow is named "Rating Engine" with `outputType: "console"` and **no** `waitForPort` (port 5001 is not in Replit's watchable list — the service still starts fine).
- WeasyPrint system deps installed via Nix: `pango cairo gdk-pixbuf harfbuzz fontconfig freetype gobject-introspection libffi`.
- Python packages: `flask weasyprint` (pip, Python 3.11).
- PDF generation confirmed working: `GET http://127.0.0.1:5001/test-pdf` returns a valid PDF/1.7 document (~11 KB).
