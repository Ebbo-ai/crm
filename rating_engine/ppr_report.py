"""
PPR Report Generator — STUB FILE
==================================
Replace this file with your production implementation.
The stub below returns a clearly-labelled placeholder HTML page so the
display plumbing can be tested before the real renderer is dropped in.

Expected interface (must be preserved in the replacement):

    GENERATOR_VERSION: str
        Semantic version string embedded in every saved PDF.  Used to
        reproduce the exact document a broker is holding months later.

    generate(payload: dict, output_format: str = "html") -> str | bytes
        Build the monthly performance report.

        payload keys
        ─────────────
        client          dict  {client_code, client_name, funding_basis}
        plans           list  — one entry per plan (see "Plan shape" below)
        generated_at    str   ISO-8601 datetime when the report was requested
        data_current_as_of  str  "YYYY-MM" of the latest month included

        Plan shape
        ──────────
        plan_id           int
        plan_name         str
        plan_year         int
        effective_date    str   ISO date — first day of the plan year
        deductible        float | None
        preventive_percent   int | None
        corrective_percent   int | None
        restorative_percent  int | None
        annual_limit      float | None
        months            list — ordered list of calendar months in the plan year

        Month shape (inside plan.months)
        ─────────────────────────────────
        report_month      int   1–12
        report_year       int
        ee_count          int | None
        ee_spouse_count   int | None
        ee_child_count    int | None
        family_count      int | None
        submitted_charges float | None
        paid_claims       float | None
        claim_count       int | None
        reason_code       str | None   — ppr_reason_code enum value
        reason_note       str | None   — required when reason_code = OTHER
        release_month     int | None
        release_year      int | None
        admin_fee_total   float | None — ALL-IN fee; never break this out

        NOTE: admin_fee_total is the single overhead figure shown on the
        report.  It covers TPA administration, programme / marketing fee,
        broker compensation (where applicable), and network fees (rare).
        Do NOT expose any sub-components of this figure.

        output_format
        ─────────────
        "html"  → return str  (a complete, self-contained HTML document)
        "pdf"   → return bytes (PDF binary, ready to write to disk)
"""

from __future__ import annotations
from datetime import datetime

# Bump this string whenever the report layout or calculation methodology
# changes.  It is stored against every saved PDF document record so that
# a historical report can always be regenerated with the same generator.
GENERATOR_VERSION = "stub-0.1"

_MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _fmt_currency(v) -> str:
    if v is None:
        return "—"
    return f"${float(v):,.2f}"


def _fmt_pct(v) -> str:
    if v is None:
        return "—"
    return f"{float(v):.1f}%"


def _loss_ratio(paid, admin_fee) -> float | None:
    """paid_claims / admin_fee_total  (admin fee = expected claims budget)."""
    if paid is None or admin_fee is None or admin_fee == 0:
        return None
    return float(paid) / float(admin_fee) * 100


def _plan_html(plan: dict) -> str:
    months = plan.get("months", [])
    rows_html = ""
    ytd_paid = 0.0
    ytd_admin = 0.0
    for m in months:
        month_name = _MONTH_NAMES[m["report_month"] - 1] if m.get("report_month") else "—"
        paid  = m.get("paid_claims")
        admin = m.get("admin_fee_total")
        lr    = _loss_ratio(paid, admin)
        ytd_paid  += float(paid  or 0)
        ytd_admin += float(admin or 0)
        ytd_lr = _loss_ratio(ytd_paid, ytd_admin)
        enroll = (m.get("ee_count") or 0) + (m.get("ee_spouse_count") or 0) + \
                 (m.get("ee_child_count") or 0) + (m.get("family_count") or 0)
        reason = m.get("reason_code") or ""
        lr_color = "#EF4444" if lr and lr >= 100 else ("#F5A623" if lr and lr >= 85 else "#22C55E")
        rows_html += f"""
        <tr>
          <td>{month_name} {m.get("report_year","")}</td>
          <td style="text-align:right">{enroll or "—"}</td>
          <td style="text-align:right">{_fmt_currency(m.get("submitted_charges"))}</td>
          <td style="text-align:right">{_fmt_currency(paid)}</td>
          <td style="text-align:right">{_fmt_currency(admin)}</td>
          <td style="text-align:right;color:{lr_color};font-weight:600">{_fmt_pct(lr)}</td>
          <td style="text-align:right">{_fmt_pct(ytd_lr)}</td>
          <td style="font-size:11px;color:#666">{reason}</td>
        </tr>"""

    return f"""
    <section style="margin-bottom:40px">
      <h2 style="color:#1A5276;border-bottom:2px solid #1A5276;padding-bottom:6px">
        {plan.get("plan_name","Plan")} — Plan Year {plan.get("plan_year","")}
      </h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#1A5276;color:#fff">
            <th style="padding:8px;text-align:left">Period</th>
            <th style="padding:8px;text-align:right">Enrolled</th>
            <th style="padding:8px;text-align:right">Submitted</th>
            <th style="padding:8px;text-align:right">Paid Claims</th>
            <th style="padding:8px;text-align:right">Admin Fee</th>
            <th style="padding:8px;text-align:right">Monthly LR</th>
            <th style="padding:8px;text-align:right">YTD LR</th>
            <th style="padding:8px;text-align:left">Note</th>
          </tr>
        </thead>
        <tbody>{rows_html}</tbody>
      </table>
    </section>"""


def generate(payload: dict, output_format: str = "html"):
    """Generate the PPR report as HTML or PDF."""
    client   = payload.get("client", {})
    plans    = payload.get("plans", [])
    gen_at   = payload.get("generated_at", datetime.utcnow().isoformat())
    as_of    = payload.get("data_current_as_of", "")

    plan_sections = "".join(_plan_html(p) for p in plans)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Performance Report — {client.get("client_name","")}</title>
  <style>
    body {{ font-family: 'Helvetica Neue', Arial, sans-serif; margin: 40px; color: #2C3E50; }}
    table td, table th {{ padding: 7px 10px; border-bottom: 1px solid #e2e8f0; }}
    table tr:nth-child(even) td {{ background: #f8fafc; }}
    @media print {{ body {{ margin: 20px; }} }}
  </style>
</head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px">
    <div>
      <h1 style="margin:0;color:#1A5276;font-size:22px">Monthly Performance Report</h1>
      <h2 style="margin:4px 0 0;font-weight:400;font-size:16px;color:#555">
        {client.get("client_name","")}
        <span style="font-size:13px;color:#94a3b8;margin-left:8px">{client.get("client_code","")}</span>
      </h2>
    </div>
    <div style="text-align:right;font-size:11px;color:#94a3b8;line-height:1.6">
      <div>Generated: {gen_at[:16].replace("T"," ")} UTC</div>
      <div>Data current as of: {as_of}</div>
      <div>Generator: v{GENERATOR_VERSION}</div>
    </div>
  </div>
  <p style="background:#FEF9C3;border:1px solid #FDE68A;padding:10px 14px;border-radius:6px;
            font-size:12px;color:#92400E;margin-bottom:30px">
    ⚠️ This is a <strong>stub report</strong>.  Replace
    <code>rating_engine/ppr_report.py</code> with your production
    implementation to generate the real report.
  </p>
  {plan_sections if plan_sections else
    '<p style="color:#94a3b8;text-align:center;padding:40px 0">No performance data on file for this period.</p>'}
</body>
</html>"""

    if output_format == "html":
        return html

    # PDF path — requires WeasyPrint (already installed)
    from weasyprint import HTML as WPhtml
    return WPhtml(string=html).write_pdf()
