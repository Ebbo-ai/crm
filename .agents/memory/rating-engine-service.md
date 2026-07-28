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
- Python packages: `flask weasyprint` (pip, **Python 3.12** — required; generate_renewal.py uses backslashes inside nested f-strings which is only valid in 3.12+).
- `generate_renewal.py` interface: `validate(cfg)`, `advisories(cfg)`, `build_html(cfg)`, `compute(plan)`, `load_config(path)`. Entry: `build_html(cfg)` → HTML string → WeasyPrint → PDF bytes.
- `config_sample.py` holds a validated single-plan dental CONFIG that passes validate() and advisories() with zero errors/warnings.
- Node route `POST /api/clients/:id/generate-renewal-draft` calls `/generate-renewal-sample` on the Python service, saves PDF to `uploads/documents/{clientId}/`, creates a RENEWAL_PROPOSAL document record, returns `{document, scenarios, total_pages}`.
- End-to-end confirmed: 5-page PDF, 187 KB, PDF/1.7, RENEWAL_PROPOSAL doc saved to DB.
