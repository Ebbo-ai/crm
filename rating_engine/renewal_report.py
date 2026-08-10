"""
Renewal Report Generator
========================
The document that completes a renewal. It is produced at the final pipeline
step, "Emailed to 90 Degree", once a client has accepted their renewal.

Its job is to tell 90 Degree Benefits exactly what to change in their claims
system for the new plan year. This was previously done by hand.

AUDIENCE: 90 Degree Benefits. Not the client, and not the broker.

    CRITICAL RULE
    -------------
    Everywhere else in this application, broker compensation is folded into a
    single combined administrative fee, because those documents are client
    facing. Proposals, plan performance reports and employee handouts all
    suppress it.

    This report is the deliberate exception, and that exception is the entire
    point of the document. 90 Degree Benefits sets up the billing, so they need
    every fee component broken out separately, broker compensation included.

    Do NOT apply the client facing suppression rule here. If this report hides
    broker compensation it fails at the only job it has.

WRITING STYLE
-------------
No em dashes anywhere in generated text. Use commas or full stops. Keep the
language short and declarative. This is a working document for an
administrator, not a sales piece.

Expected interface (must be preserved in any replacement):

    GENERATOR_VERSION: str
        Semantic version embedded in every saved PDF, so a document someone is
        holding months later can be reproduced.

    generate(payload: dict, output_format: str = "html") -> str | bytes

        payload keys
        -------------
        client   dict {client_name, group_number, plan_year, anniversary_date}
        plans    list, one entry per plan carried by the client
        notices  list of str, items needing attention across all plans
        generated_at  str, ISO-8601

        Plan shape
        ----------
        plan_name        str          the benefit level within the coverage,
                                      for example Standard or Premium. Free
                                      text: clients use Gold/Silver, Low/High,
                                      Union/Non Union and similar
        coverage         str | None   the benefit provided, for example
                                      "dental" or "dental and vision". Plans are
                                      identified by coverage AND name, because
                                      one client can carry Standard on dental
                                      and Standard again on vision
        accepted_option  str | None   VALUE | RECOMMENDED | PROTECTIVE
        fee_basis        str          PEPM | FIXED_MONTHLY
        has_prior        bool         is there a prior plan year to compare to
        has_new          bool         does the new plan year exist yet
        unmatched_new    bool         the client has earlier plan years on
                                      record but none carries this plan name,
                                      so this may be a rename rather than a new
                                      plan and the two cannot be told apart
        rename_candidates list of str prior year plans left without a
                                      counterpart, the possible other half of a
                                      rename. Already carry their coverage in
                                      the text. Empty unless unmatched_new
        coverage_split   bool         one side of a suspected split: shares its
                                      name with another plan this year and with
                                      one earlier plan that has no coverage
                                      recorded, so it cannot be paired without
                                      guessing. Mutually exclusive with
                                      unmatched_new
        coverage_split_prior_year int | None  the year of that earlier plan
        coverage_backfilled bool          paired to an earlier plan that has no
                                      coverage recorded, on the name alone. It
                                      was the only candidate, which is not proof
                                      of identity, so the comparison is shown as
                                      provisional
        coverage_backfilled_year int | None  the year of that earlier plan
        prior_plan_year  int | None
        new_plan_year    int | None
        design           list of design rows (see below)
        broker           dict {current, new} each {mode, percent, amount}
        tiers            list of tier rows, PEPM plans (see below)
        group_charges    dict {current, new} | None. Charges billed as one flat
                         monthly amount for the group instead of per employee.
                         Present for FIXED_MONTHLY fee basis plans, and also for
                         per employee plans whose broker compensation alone is a
                         flat monthly group charge.

        Design row
        ----------
        label    str
        kind     str   money | percent | bool | text
        current  raw value | None
        new      raw value | None

        Values arrive raw, not preformatted, so that "no change" is decided by
        comparing actual values rather than formatted strings.

        Tier row
        --------
        order          int
        current_label  str | None
        new_label      str | None
        current        dict | None, fee components
        new            dict | None, fee components

        Fee component dict
        ------------------
        base_admin_fee, cobra_fee, simple_fee, network_fee, broker_fee,
        total_admin_fee, expected_claims, monthly_premium
"""

from __future__ import annotations

import html as _html
from datetime import datetime

# Bump whenever the layout or the set of reported fields changes.
GENERATOR_VERSION = "1.0.0"

NOT_RECORDED = "Not recorded"

OPTION_LABELS = {
    "VALUE": "Value",
    "RECOMMENDED": "Recommended",
    "PROTECTIVE": "Protective",
}

# Order matters. This is the order 90 Degree Benefits reads the billing setup in,
# building from components up to the premium.
FEE_ROWS = [
    ("base_admin_fee", "90 Degree base administrative fee"),
    ("cobra_fee", "COBRA fee"),
    ("simple_fee", "Simple fee"),
    ("network_fee", "Network fee"),
    ("broker_fee", "Broker compensation"),
    ("total_admin_fee", "Total administrative fee"),
    ("expected_claims", "Expected claims"),
    ("monthly_premium", "Premium"),
]

# Rows that close out a group and should read as totals rather than components.
EMPHASIS_KEYS = {"total_admin_fee", "monthly_premium"}

# A flat monthly plan charges the group one amount, so the fee components are a
# group level figure. COBRA is charged per employee and is not part of it.
FLAT_KEYS = [
    "base_admin_fee", "simple_fee", "network_fee", "broker_fee", "total_admin_fee",
]

# Flat monthly plans still hold expected claims and premium per tier, so those
# two are reported per tier even though the fee itself is not.
CLAIM_KEYS = ["expected_claims", "monthly_premium"]


def _esc(v) -> str:
    return _html.escape("" if v is None else str(v))


def _money(v) -> str:
    if v is None:
        return NOT_RECORDED
    return f"${float(v):,.2f}"


def _percent(v) -> str:
    if v is None:
        return NOT_RECORDED
    f = float(v)
    return f"{f:g}%"


def _boolean(v) -> str:
    if v is None:
        return NOT_RECORDED
    return "Yes" if v else "No"


def _plain(v) -> str:
    if v is None or str(v).strip() == "":
        return NOT_RECORDED
    return str(v)


def _fmt(kind: str, value) -> str:
    if kind == "money":
        return _money(value)
    if kind == "percent":
        return _percent(value)
    if kind == "bool":
        return _boolean(value)
    return _plain(value)


def _same(a, b) -> bool:
    """Compare raw values, tolerating int vs float and decimal-as-string."""
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    try:
        return abs(float(a) - float(b)) < 0.0001
    except (TypeError, ValueError):
        return str(a).strip() == str(b).strip()


def _or_list(names: list) -> str:
    """Join names for prose: "A", "A" or "B", "A", "B" or "C"."""
    q = [f'"{_plain(n)}"' for n in names]
    if len(q) <= 1:
        return q[0] if q else ""
    return ", ".join(q[:-1]) + " or " + q[-1]


def _broker_basis_phrase(b: dict | None) -> str:
    """Describe how broker compensation is calculated, in one plain clause."""
    if not b:
        return NOT_RECORDED
    mode = b.get("mode") or "NONE"
    if mode == "NONE":
        return "none"
    if mode == "PERCENT_OF_PREMIUM":
        pct = b.get("percent")
        return f"{_percent(pct)} of premium" if pct is not None else "a percentage of premium"
    if mode == "FLAT_PEPM":
        return f"{_money(b.get('amount'))} per employee per month"
    if mode == "FIXED_MONTHLY":
        return f"{_money(b.get('amount'))} flat per month for the group"
    return _plain(mode)


# ---------------------------------------------------------------------------
# Section builders
# ---------------------------------------------------------------------------

def _design_table(rows: list, has_prior: bool) -> str:
    if not rows:
        return '<p class="muted">No plan design fields recorded.</p>'

    body = ""
    for r in rows:
        cur_raw, new_raw = r.get("current"), r.get("new")
        kind = r.get("kind", "text")
        cur, new = _fmt(kind, cur_raw), _fmt(kind, new_raw)

        if not has_prior:
            status, cls = "No prior year on record", "st-note"
        elif _same(cur_raw, new_raw):
            status, cls = "No change", "st-same"
        else:
            status, cls = "Changed", "st-diff"

        body += (
            f'<tr class="{cls}">'
            f"<td>{_esc(r.get('label'))}</td>"
            f"<td>{_esc(cur)}</td>"
            f"<td>{_esc(new)}</td>"
            f'<td class="status">{_esc(status)}</td>'
            "</tr>"
        )

    return f"""
    <table class="grid">
      <thead><tr><th>Item</th><th>Current</th><th>New</th><th>Status</th></tr></thead>
      <tbody>{body}</tbody>
    </table>"""


def _fee_block(
    title: str,
    subtitle: str,
    current: dict | None,
    new: dict | None,
    has_prior: bool,
    keys: list | None = None,
) -> str:
    rows = FEE_ROWS if keys is None else [(k, lbl) for k, lbl in FEE_ROWS if k in keys]
    body = ""
    for key, label in rows:
        cur_raw = current.get(key) if current else None
        new_raw = new.get(key) if new else None
        cls = "emph" if key in EMPHASIS_KEYS else ""

        if not has_prior:
            status = "No prior year on record"
        elif _same(cur_raw, new_raw):
            status = "No change"
        else:
            status = "Changed"

        body += (
            f'<tr class="{cls}">'
            f"<td>{_esc(label)}</td>"
            f"<td>{_esc(_money(cur_raw))}</td>"
            f"<td>{_esc(_money(new_raw))}</td>"
            f'<td class="status">{_esc(status)}</td>'
            "</tr>"
        )

    sub = f'<div class="sub">{_esc(subtitle)}</div>' if subtitle else ""
    return f"""
    <div class="feeblock">
      <div class="feehead">{_esc(title)}</div>
      {sub}
      <table class="grid">
        <thead><tr><th>Component</th><th>Current</th><th>New</th><th>Status</th></tr></thead>
        <tbody>{body}</tbody>
      </table>
    </div>"""


def _fees_section(plan: dict) -> str:
    has_prior = bool(plan.get("has_prior"))
    fee_basis = plan.get("fee_basis") or "PEPM"

    is_flat = fee_basis == "FIXED_MONTHLY"

    def _tier_blocks(keys: list | None) -> str:
        tiers = plan.get("tiers") or []
        if not tiers:
            return '<p class="muted">No tiers or rates recorded for this plan.</p>'
        parts = []
        for t in tiers:
            cur_label, new_label = t.get("current_label"), t.get("new_label")
            if cur_label and new_label and cur_label != new_label:
                title = _plain(new_label)
                subtitle = f'This tier was previously labelled "{cur_label}".'
            else:
                title = _plain(new_label or cur_label)
                subtitle = ""
                if not new_label:
                    subtitle = "This tier is not present in the new plan year."
                elif not cur_label and has_prior:
                    # With no prior year every tier looks new, which is noise.
                    subtitle = "This tier is new for this plan year."
            parts.append(
                _fee_block(title, subtitle, t.get("current"), t.get("new"), has_prior, keys)
            )
        return "".join(parts)

    group = plan.get("group_charges") or {}

    if is_flat:
        block = _fee_block(
            "Flat monthly charge for the group",
            "This plan bills a flat monthly amount for the group. The figures below are "
            "not per employee rates and do not vary with enrollment.",
            group.get("current"),
            group.get("new"),
            has_prior,
            FLAT_KEYS,
        )
        block += (
            '<div class="feehead" style="margin-top:10px">Expected claims and premium by tier</div>'
            + _tier_blocks(CLAIM_KEYS)
        )
    else:
        block = _tier_blocks(None)
        # A per employee plan can still pay broker compensation as one flat
        # monthly amount for the group. Every tier row carries zero broker in
        # that case, so the real figure has to be reported here or 90 Degree
        # Benefits would set up the billing paying the broker nothing.
        if group.get("current") or group.get("new"):
            block += _fee_block(
                "Broker compensation, flat monthly charge for the group",
                "Broker compensation on this plan is one flat monthly amount for the group. "
                "It is not included in the per employee rates above, which show zero broker "
                "compensation for that reason.",
                group.get("current"),
                group.get("new"),
                has_prior,
                ["broker_fee"],
            )

    broker = plan.get("broker") or {}
    cur_phrase = _broker_basis_phrase(broker.get("current"))
    new_phrase = _broker_basis_phrase(broker.get("new"))
    if has_prior:
        basis = f"Broker compensation basis: current {cur_phrase}, new {new_phrase}."
    else:
        basis = f"Broker compensation basis: {new_phrase}."

    return block + f'<p class="basis">{_esc(basis)}</p>'


def _plan_heading(plan: dict) -> str:
    """
    Coverage and plan name are two different things. Coverage is the benefit
    provided; the name is the benefit level within it. A client can carry a
    Standard on dental and a Standard on vision, so the heading has to name both
    or two unrelated sections read as though they were the same plan.
    """
    name = str(plan.get("plan_name") or "").strip() or "Plan"
    # Deliberately not _plain(): an unrecorded coverage should leave the heading
    # as the bare plan name, not print a "not recorded" placeholder in brackets.
    coverage = str(plan.get("coverage") or "").strip()
    return f"{name} ({coverage})" if coverage else name


def _plan_section(plan: dict) -> str:
    accepted = plan.get("accepted_option")
    accepted_label = OPTION_LABELS.get(accepted, _plain(accepted))

    year_bits = []
    has_prior_year = plan.get("prior_plan_year") is not None
    if has_prior_year:
        year_bits.append(f"Current plan year {plan['prior_plan_year']}")
    if plan.get("new_plan_year") is not None:
        # Only lower case when it follows the current year clause.
        lead = "new" if has_prior_year else "New"
        year_bits.append(f"{lead} plan year {plan['new_plan_year']}")
    years = ", ".join(year_bits) + "." if year_bits else ""

    warn = ""
    if not plan.get("has_new"):
        warn = (
            '<p class="warn">There is no plan record for the new plan year yet. '
            "The new values below cannot be reported until it is set up.</p>"
        )
    elif plan.get("coverage_split"):
        # Same name as another plan this year, and as one earlier plan carrying
        # no coverage. Almost always one plan that split into separate dental and
        # vision plans. Which side inherits the history is a judgement call the
        # data cannot make, so it is put to the reader plainly.
        prior = plan.get("coverage_split_prior_year")
        when = f"the {prior}" if prior else "an earlier"
        warn = (
            '<p class="warn">No coverage was recorded on '
            f"{_esc(when)} plan of this name, and more than one plan this year shares it, "
            "so this plan cannot be paired to it without guessing and everything below is "
            "reported as new. If this plan continues that one, set the coverage on the "
            "earlier record and regenerate before sending.</p>"
        )
    elif plan.get("unmatched_new"):
        # Plans are paired across years by coverage and name. A renamed plan and
        # a genuinely new plan both fail to match, and only one of them is
        # correct to show as all new, so the reader is told rather than left to
        # assume.
        cands = plan.get("rename_candidates") or []
        tail = (
            f"{_or_list(cands)} was carried last plan year and has no counterpart this year. "
            "If this plan is that plan under a new name, nothing below is a like for like "
            "comparison. Confirm before sending."
            if cands
            else "Confirm this is a new plan and not a rename before sending."
        )
        warn = (
            '<p class="warn">No plan with this coverage and name exists in any earlier '
            f"plan year, so everything below is reported as new. {_esc(tail)}</p>"
        )
    elif not plan.get("has_prior"):
        warn = (
            '<p class="warn">There is no prior plan year on record for this plan, '
            "so no comparison is possible. The values below are the new plan year.</p>"
        )
    elif plan.get("coverage_backfilled"):
        # Paired to an earlier plan that has no coverage recorded. It was the only
        # candidate, but being the only candidate is not proof of identity: the
        # earlier plan could have been a different coverage that ended, with this
        # one merely sharing its name. Treated as provisional so nobody reads the
        # comparison below as settled.
        prior = plan.get("coverage_backfilled_year")
        when = f"the {prior}" if prior else "an earlier"
        warn = (
            '<p class="warn">This comparison is provisional. No coverage was recorded on '
            f"{_esc(when)} plan of this name, so it was matched on the name alone. It is the "
            "only plan it could be, but that is not proof it is the same plan rather than a "
            "different one that ended. Confirm it, and set the coverage on the earlier record "
            "so future reports pair it outright.</p>"
        )

    return f"""
    <section class="plan">
      <h2>{_esc(_plan_heading(plan))}</h2>
      <div class="meta">
        <span class="pill">Accepted option: {_esc(accepted_label)}</span>
        <span class="years">{_esc(years)}</span>
      </div>
      {warn}
      <h3>Plan design</h3>
      {_design_table(plan.get("design") or [], bool(plan.get("has_prior")))}
      <h3>Fee structure</h3>
      {_fees_section(plan)}
    </section>"""


def _notices_section(notices: list) -> str:
    if not notices:
        return """
    <section class="notices">
      <h2>Items needing attention</h2>
      <p class="muted">None. No tier changes or other exceptions were found.</p>
    </section>"""

    items = "".join(f"<li>{_esc(n)}</li>" for n in notices)
    return f"""
    <section class="notices">
      <h2>Items needing attention</h2>
      <ul>{items}</ul>
    </section>"""


CSS = """
  @page { size: Letter; margin: 18mm 14mm; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #23303d; font-size: 12px; margin: 0; }
  h1 { font-size: 20px; color: #1A5276; margin: 0; }
  h2 { font-size: 15px; color: #1A5276; margin: 0 0 8px; padding-bottom: 5px;
       border-bottom: 2px solid #1A5276; }
  h3 { font-size: 12.5px; color: #23303d; margin: 16px 0 6px; text-transform: uppercase;
       letter-spacing: .04em; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          margin-bottom: 14px; }
  .head .sub { font-size: 13px; color: #475569; margin-top: 3px; }
  .head .right { text-align: right; font-size: 10px; color: #94a3b8; line-height: 1.6; }
  .idbar { border: 1px solid #dbe3ea; background: #f6f9fb; border-radius: 5px;
           padding: 9px 12px; margin-bottom: 16px; font-size: 11.5px; }
  .idbar span { margin-right: 20px; }
  .idbar b { color: #1A5276; }
  .conf { background: #FEF3C7; border: 1px solid #FCD34D; color: #78350F;
          padding: 8px 12px; border-radius: 5px; font-size: 11px; margin-bottom: 18px; }
  section.plan { margin-bottom: 26px; page-break-inside: avoid; }
  .meta { margin-bottom: 8px; }
  .pill { display: inline-block; background: #1A5276; color: #fff; border-radius: 3px;
          padding: 2px 9px; font-size: 11px; font-weight: 600; }
  .years { font-size: 11px; color: #64748b; margin-left: 10px; }
  table.grid { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 6px; }
  table.grid th { background: #eef4f8; color: #1A5276; text-align: left; font-weight: 600;
                  padding: 5px 8px; border-bottom: 1px solid #cfdae3; }
  table.grid td { padding: 4px 8px; border-bottom: 1px solid #eef1f4; }
  table.grid td:nth-child(2), table.grid td:nth-child(3),
  table.grid th:nth-child(2), table.grid th:nth-child(3) { text-align: right; width: 19%; }
  td.status { width: 20%; font-size: 10.5px; color: #64748b; }
  tr.st-diff td.status { color: #b45309; font-weight: 600; }
  tr.emph td { font-weight: 700; background: #f8fafc; }
  .feeblock { margin-bottom: 12px; page-break-inside: avoid; }
  .feehead { font-weight: 700; font-size: 12px; color: #23303d; margin-bottom: 2px; }
  .feeblock .sub { font-size: 10.5px; color: #64748b; margin-bottom: 4px; }
  .basis { font-size: 11px; color: #334155; background: #f6f9fb; border-left: 3px solid #1A5276;
           padding: 6px 10px; margin: 4px 0 0; }
  .warn { font-size: 11px; color: #92400E; background: #FEF9C3; border: 1px solid #FDE68A;
          padding: 6px 10px; border-radius: 4px; }
  .muted { color: #94a3b8; }
  section.notices ul { margin: 0; padding-left: 18px; }
  section.notices li { margin-bottom: 3px; font-size: 11.5px; }
"""


def generate(payload: dict, output_format: str = "html"):
    """Build the renewal report as HTML or PDF."""
    client = payload.get("client", {}) or {}
    plans = payload.get("plans", []) or []
    notices = payload.get("notices", []) or []
    gen_at = payload.get("generated_at") or datetime.utcnow().isoformat()

    plan_sections = "".join(_plan_section(p) for p in plans)
    if not plan_sections:
        plan_sections = (
            '<p class="muted">No plan on this renewal has an accepted option recorded, '
            "so there is nothing to report.</p>"
        )

    html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Renewal Report, {_esc(client.get("client_name", ""))}</title>
<style>{CSS}</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>Renewal Report</h1>
      <div class="sub">Prepared for 90 Degree Benefits</div>
    </div>
    <div class="right">
      <div>Generated: {_esc(gen_at[:16].replace("T", " "))} UTC</div>
      <div>Generator: v{_esc(GENERATOR_VERSION)}</div>
    </div>
  </div>

  <div class="idbar">
    <span><b>Client:</b> {_esc(client.get("client_name", NOT_RECORDED))}</span>
    <span><b>Group number:</b> {_esc(client.get("group_number") or NOT_RECORDED)}</span>
    <span><b>Plan year:</b> {_esc(client.get("plan_year", NOT_RECORDED))}</span>
    <span><b>Anniversary date:</b> {_esc(client.get("anniversary_date") or NOT_RECORDED)}</span>
  </div>

  <div class="conf">
    This document lists every fee component separately, including broker compensation,
    so that billing can be set up correctly. It is internal to 90 Degree Benefits and
    Simple Benefits. Do not send it to the client or the broker.
  </div>

  {plan_sections}
  {_notices_section(notices)}
</body>
</html>"""

    if output_format == "html":
        return html_doc

    from weasyprint import HTML as WPhtml
    return WPhtml(string=html_doc).write_pdf()
