"""
Simple Benefits – Rating Engine Service
Internal-only HTTP service (port 5001).
Not exposed to the browser; called only by the Node backend.
"""

import io
import logging

from flask import Flask, send_file, jsonify

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [rating] %(message)s")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "rating-engine"})


# ---------------------------------------------------------------------------
# PDF proof-of-concept endpoint
# Renders a minimal branded HTML page to PDF and returns the binary.
# ---------------------------------------------------------------------------

TEST_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', Arial, sans-serif;
    background: #f4f8fb;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
  }
  .card {
    background: #ffffff;
    border-radius: 12px;
    padding: 48px 56px;
    box-shadow: 0 4px 24px rgba(26,82,118,0.10);
    text-align: center;
    max-width: 480px;
  }
  .logo { font-size: 32px; font-weight: 700; color: #1A5276; margin-bottom: 4px; }
  .sub  { font-size: 14px; color: #E67E22; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 32px; }
  h1    { font-size: 22px; font-weight: 700; color: #1A5276; margin-bottom: 12px; }
  p     { font-size: 14px; color: #5D6D7E; line-height: 1.6; }
  .stamp {
    display: inline-block;
    margin-top: 28px;
    padding: 8px 20px;
    border-radius: 999px;
    background: #eaf4fb;
    color: #1A5276;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.05em;
  }
</style>
</head>
<body>
<div class="card">
  <div class="logo">Simple Benefits</div>
  <div class="sub">TPA Client Management</div>
  <h1>Rating Engine — PDF Proof of Concept</h1>
  <p>WeasyPrint rendered this document successfully.
     System graphics libraries (Pango, Cairo, GDK-Pixbuf) are
     confirmed working. The rating engine is ready to produce
     branded proposal PDFs.</p>
  <div class="stamp">✓ PDF generation verified</div>
</div>
</body>
</html>"""


@app.get("/test-pdf")
def test_pdf():
    """Render a one-page branded test PDF and return it as application/pdf."""
    try:
        from weasyprint import HTML
        pdf_bytes = HTML(string=TEST_HTML).write_pdf()
        buf = io.BytesIO(pdf_bytes)
        buf.seek(0)
        app.logger.info("test-pdf: rendered %d bytes", len(pdf_bytes))
        return send_file(
            buf,
            mimetype="application/pdf",
            as_attachment=False,
            download_name="rating-engine-test.pdf",
        )
    except Exception as exc:
        app.logger.exception("test-pdf: render failed")
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=False)
