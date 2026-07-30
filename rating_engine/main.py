"""
Simple Benefits – Rating Engine Service
Internal-only HTTP service (port 5001).
Not exposed to the browser; called only by the Node backend.
"""

import base64
import copy
import io
import logging
import os
import sys

from flask import Flask, request, send_file, jsonify

# Make sure the rating_engine directory is importable
sys.path.insert(0, os.path.dirname(__file__))

from generate_renewal import (
    validate, advisories, build_html, compute, load_config,
)
from weasyprint import HTML
from ppr_import import process_file as ppr_process_file
from ppr_report import generate as ppr_generate, GENERATOR_VERSION as PPR_GENERATOR_VERSION

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [rating] %(message)s")

_SAMPLE_PATH = os.path.join(os.path.dirname(__file__), "config_sample.py")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _render_cfg(cfg):
    """Validate, render to PDF bytes, extract per-plan scenarios. Raises on error."""
    problems = validate(cfg)
    if problems:
        raise ValueError("Config rejected:\n" + "\n".join(problems))
    warns = advisories(cfg)

    html_str = build_html(cfg)
    pdf_bytes = HTML(string=html_str).write_pdf()

    # Extract scenario rows per plan for the caller's convenience
    scenarios_out = []
    for plan in cfg["plans"]:
        d = compute(plan)
        scenarios_out.append({
            "plan_name": plan["name"],
            "coverage":  plan["coverage"],
            "admin_new": d["admin_new"],
            "subs":      d["subs"],
            "adequate":  d["adequate"],
            "surplus":   d["surplus"],
            "rows": [
                {
                    "key":         r["key"],
                    "name":        r["name"],
                    "net":         r["net"],
                    "tiers":       r["tiers"],
                    "collected":   r["collected"],
                    "draw":        r["draw"],
                    "end_reserve": r["end_reserve"],
                    "reserve_mo":  round(r["reserve_mo"], 2),
                    "recommended": r["recommended"],
                }
                for r in d["rows"]
            ],
        })

    return {
        "pdf_b64":    base64.b64encode(pdf_bytes).decode(),
        "total_pages": cfg["total_pages"],
        "scenarios":  scenarios_out,
        "advisories": warns,
    }


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "rating-engine"})


# ---------------------------------------------------------------------------
# POST /generate-renewal
# Accept a full cfg dict as JSON, render, return scenarios + PDF as base64.
# ---------------------------------------------------------------------------

@app.post("/generate-renewal")
def generate_renewal():
    cfg = request.get_json(force=True, silent=True)
    if not cfg or not isinstance(cfg, dict):
        return jsonify({"error": "Request body must be a JSON object (cfg dict)"}), 400
    try:
        result = _render_cfg(cfg)
        app.logger.info("generate-renewal: %s — %d pages, %d bytes",
                        cfg.get("group_name", "?"), result["total_pages"],
                        len(base64.b64decode(result["pdf_b64"])))
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        app.logger.exception("generate-renewal: render failed for %s",
                              cfg.get("group_name", "?"))
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# POST /generate-renewal-sample
# Load the bundled sample config, optionally override header fields, render.
# Body (all optional): { group_name, group_id, prepared_for,
#                        renewal_effective, prepared_date }
# ---------------------------------------------------------------------------

@app.post("/generate-renewal-sample")
def generate_renewal_sample():
    overrides = request.get_json(force=True, silent=True) or {}
    try:
        cfg = copy.deepcopy(load_config(_SAMPLE_PATH))
    except Exception as exc:
        return jsonify({"error": f"Could not load sample config: {exc}"}), 500

    # Apply caller's overrides to the program-level header fields
    for field in ("group_name", "group_id", "prepared_for",
                  "renewal_effective", "prepared_date", "plan_year"):
        if field in overrides:
            cfg[field] = overrides[field]

    try:
        result = _render_cfg(cfg)
        app.logger.info("generate-renewal-sample: %s — %d pages",
                        cfg.get("group_name"), result["total_pages"])
        return jsonify(result)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        app.logger.exception("generate-renewal-sample failed")
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# GET /test-pdf  (original proof-of-concept, kept for smoke testing)
# ---------------------------------------------------------------------------

TEST_HTML = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<style>
  body { font-family: Arial, sans-serif; display:flex; align-items:center;
         justify-content:center; height:100vh; background:#f4f8fb; margin:0; }
  .card { background:#fff; border-radius:12px; padding:48px 56px;
          box-shadow:0 4px 24px rgba(26,82,118,.1); text-align:center; max-width:480px; }
  h1 { color:#1A5276; margin:0 0 12px; }
  p  { color:#5D6D7E; font-size:14px; line-height:1.6; }
  .stamp { display:inline-block; margin-top:28px; padding:8px 20px;
           border-radius:999px; background:#eaf4fb; color:#1A5276;
           font-size:12px; font-weight:600; }
</style></head>
<body><div class="card">
  <h1>Rating Engine — PDF Proof of Concept</h1>
  <p>WeasyPrint rendered this document successfully. System graphics libraries
     are confirmed working.</p>
  <div class="stamp">✓ PDF generation verified</div>
</div></body></html>"""


@app.get("/test-pdf")
def test_pdf():
    try:
        pdf_bytes = HTML(string=TEST_HTML).write_pdf()
        buf = io.BytesIO(pdf_bytes)
        buf.seek(0)
        return send_file(buf, mimetype="application/pdf",
                         download_name="rating-engine-test.pdf")
    except Exception as exc:
        app.logger.exception("test-pdf: render failed")
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# POST /parse-ppr-import
# Accept a combined monthly PPR file (CSV or Excel) plus a lookup context,
# return classified rows: accepted, unchanged, held.
#
# Body (JSON):
#   file_b64   str   base64-encoded file bytes
#   file_ext   str   "csv" | "xlsx" | "xls"
#   context    dict  {clients, plans, current_facts}  — see ppr_import.py
# ---------------------------------------------------------------------------

@app.post("/parse-ppr-import")
def parse_ppr_import():
    body = request.get_json(force=True, silent=True) or {}
    file_b64 = body.get("file_b64", "")
    file_ext = body.get("file_ext", "csv")
    context  = body.get("context", {})

    if not file_b64:
        return jsonify({"error": "file_b64 is required"}), 400

    try:
        file_bytes = base64.b64decode(file_b64)
    except Exception as exc:
        return jsonify({"error": f"Could not decode file_b64: {exc}"}), 400

    try:
        result = ppr_process_file(file_bytes, file_ext, context)
        app.logger.info(
            "parse-ppr-import: ext=%s accepted=%d unchanged=%d held=%d",
            file_ext,
            len(result.get("accepted", [])),
            len(result.get("unchanged", [])),
            len(result.get("held", [])),
        )
        return jsonify(result)
    except Exception as exc:
        app.logger.exception("parse-ppr-import failed")
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# POST /generate-ppr-report
# Accept a data payload plus output format, return HTML string or PDF as
# base64.
#
# Body (JSON):
#   payload        dict   see ppr_report.py interface docs
#   output_format  str    "html" (default) | "pdf"
# ---------------------------------------------------------------------------

@app.post("/generate-ppr-report")
def generate_ppr_report():
    body = request.get_json(force=True, silent=True) or {}
    payload       = body.get("payload", {})
    output_format = body.get("output_format", "html")

    if output_format not in ("html", "pdf"):
        return jsonify({"error": "output_format must be 'html' or 'pdf'"}), 400

    try:
        result = ppr_generate(payload, output_format)
        app.logger.info(
            "generate-ppr-report: client=%s format=%s",
            payload.get("client", {}).get("client_code", "?"),
            output_format,
        )
        if output_format == "html":
            return jsonify({"html": result, "generator_version": PPR_GENERATOR_VERSION})
        else:
            return jsonify({
                "pdf_b64": base64.b64encode(result).decode(),
                "generator_version": PPR_GENERATOR_VERSION,
            })
    except Exception as exc:
        app.logger.exception("generate-ppr-report failed")
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=False)
