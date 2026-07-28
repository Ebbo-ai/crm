#!/usr/bin/env python3
"""
Simple Benefits — RENEWAL proposal generator (COVERAGE-AWARE).

Conforms to Simple_Dental_Renewal_Playbook_Addendum §9 / §9a:
  Cover / Summary+Financials / Scenarios+Disclosures / Renewal Acceptance.
  No rate build-up panel. Prose quotes the EMPLOYEE-ONLY rate.
  Scenarios share one adequate claims rate and differ only by surplus applied.

Coverage-aware. `program_coverage` ("Dental" | "Vision" | "Dental & Vision") drives
the cover kicker, freedom-of-choice note, trend label and disclosures. Each plan
carries its own `coverage`, so one program may mix dental and vision plans.

Multi-plan: pages = 1 cover + 2 per plan + 1 acceptance. Acceptance carries a
rate-election block per plan.

Tier schema is per-plan (`tiers` + `tier_labels`), so 4-tier dental
(EE/EC/ES/EF) and 3-tier vision (EE/E+1/EF) both work.

Holds no group data. Run: python3 generate_renewal.py config_<group>.py [out.pdf]
Render: WeasyPrint v69.

Changelog (newest first):
  2026-07-22  Recommendation sentence: admin-fee clause is now sign-aware. Previously
              hardcoded "rises $X ... to offset inflation", which mis-rendered when the
              fee holds flat or falls (e.g. St Lawrence S114 — broker comp removed,
              admin $7.45 -> $6.50). Now "rises/reduced/unchanged" per sign of
              admin_bump + broker_comp. (Addendum §7; no schema change.)
"""
import datetime as _dt
from weasyprint import HTML

# ----------------------------------------------------------------------------
# DESIGN TOKENS (playbook §16 — do not drift)
# ----------------------------------------------------------------------------
T = dict(ink="#16302b", green="#0c6b59", green_deep="#08382f", green_pale="#eaf2ef",
         gold="#b0802b", rule="#d7d2c4", muted="#5e6b66", paper="#ffffff")

LOGO_SVG = """
<svg viewBox="0 0 210 46" xmlns="http://www.w3.org/2000/svg" class="wm">
  <circle cx="20" cy="23" r="15" fill="#f2c200"/>
  <circle cx="20" cy="23" r="15" fill="none" stroke="#08382f" stroke-width="1.4"/>
  <text x="44" y="21" font-family="Georgia, serif" font-size="17"
        font-weight="700" letter-spacing="2" fill="#08382f">SIMPLE</text>
  <text x="44" y="35" font-family="Helvetica, Arial, sans-serif" font-size="7"
        letter-spacing="1.6" fill="#5e6b66">INNOVATIVE BENEFIT PLANS</text>
</svg>"""


def money(x):
    return f"(${abs(x):,.0f})" if x < 0 else f"${x:,.0f}"


def rate(x):
    return f"${x:,.2f}"


# ----------------------------------------------------------------------------
# COVERAGE-AWARE COPY
# ----------------------------------------------------------------------------
def freedom_note(coverage):
    c = coverage.lower()
    if "dental" in c and "vision" in c:
        return ("Any provider, anywhere. Participants may receive care from any licensed dental "
                "office or eye-care provider in the country — there is no network and no "
                "requirement to see an in-network provider.")
    if "vision" in c:
        return ("Any eye doctor, anywhere. Participants may receive care from any licensed "
                "eye-care provider in the country — there is no network and no requirement to "
                "see an in-network provider.")
    return ("Any dentist, anywhere. Participants may receive care from any licensed dental office "
            "in the country — there is no network and no requirement to see an in-network dentist.")


def default_disclosure_6(coverage):
    """Playbook §17 disclosure 6. Coverage-dependent; override with cfg['disclosure_6'].

    Dental programs must name which plan(s) carry orthodontia and for whom, so the
    default here is deliberately generic — set cfg['disclosure_6'] on any dental
    program (e.g. "Orthodontia is included on the Premium plan only, for adults and
    dependent children.").
    """
    c = coverage.lower()
    if "dental" in c and "vision" in c:
        return ("Orthodontia, where offered, is provided on the plan(s) named in this proposal. "
                "Vision benefits follow each plan's stated frequency and frame/lens allowances; "
                "the annual maximum caps the plan's exposure on any covered person.")
    if "vision" in c:
        return ("Vision benefits follow the plan's stated frequency and frame/lens allowances; "
                "the annual maximum caps the plan's exposure on any covered person.")
    return ("Orthodontia is provided for dependent children and is included only on the plan(s) "
            "named in this proposal.")


def pooled_note(cfg, n_plans):
    """Sentence describing the shared claims account. Silent for single-plan programs."""
    if n_plans < 2:
        return ""
    who = "both plans" if n_plans == 2 else f"all {n_plans} plans"
    return (f" The account is pooled across {who} "
            f"({money(cfg['program_surplus'])} in total).")


def cover_plans_line(cfg):
    """Cover subtitle, derived from the plan list so it can never disagree with the body.

    1 plan  -> "Standard Plan"
    2 plans -> "Premium &amp; Standard Plans"
    3+      -> "Premium, Standard &amp; Basic Plans"
    Override with cfg["cover_plans"] if a group needs bespoke wording.
    """
    names = [p["name"] for p in cfg["plans"]]
    if len(names) == 1:
        return f"{names[0]} Plan"
    joined = f"{', '.join(names[:-1])} &amp; {names[-1]}"
    return f"{joined} Plans"


# ----------------------------------------------------------------------------
# SCENARIO ENGINE  (validated against addendum §11 Saturn reference)
# ----------------------------------------------------------------------------
def compute(plan):
    a = plan["assumptions"]
    enr, cl = plan["enrollment"], plan["current_rates"]["claims"]
    tiers = plan["tiers"]
    admin_new = round(plan["current_rates"]["admin"] + a["admin_bump"] + a.get("broker_comp", 0), 2)
    subs = sum(enr.values())

    def annual_claims(mult):
        return sum(enr[t] * cl[t] * mult for t in tiers) * 12

    base = annual_claims(1.0)
    adequate = annual_claims(1.0 + a["adequacy_pct"])           # projected incurred target
    surplus = plan["financials"]["cum_surplus"]
    f = plan["financials"]
    mo_paid = f["claims_paid"] / f.get("paid_months", f["months"])  # true monthly claims

    rows = []
    for s in plan["scenarios"]:
        mult = 1.0 + s["net_claims_pct"]
        trates = {t: round(cl[t] * mult + admin_new, 2) for t in tiers}
        collected = annual_claims(mult)
        draw = adequate - collected                             # signed: negative = builds reserve
        end_reserve = surplus - draw
        rows.append(dict(key=s["key"], name=s["name"], tag=s.get("tag", ""),
                         net=s["net_claims_pct"], blurb=s["blurb"], tiers=trates,
                         collected=collected, draw=draw, end_reserve=end_reserve,
                         reserve_mo=end_reserve / mo_paid if mo_paid else 0,
                         recommended=s.get("recommended", False)))
    return dict(admin_new=admin_new, subs=subs, base=base, adequate=adequate,
                surplus=surplus, mo_paid=mo_paid, rows=rows)


# ----------------------------------------------------------------------------
# CSS
# ----------------------------------------------------------------------------
def supplement_trigger(cfg):
    """Which plans hold a surplus worth more than ONE MONTH of their own claims funding?

    That is the bar for offering the cross-plan surplus supplement (addendum §13): a
    multi-plan program where at least one plan is sitting on real, idle money while
    another is being asked for an increase. Returns [(plan, months_held), ...].
    """
    if len(cfg.get("plans", [])) < 2:
        return []
    out = []
    for p in cfg["plans"]:
        f = p["financials"]
        monthly_funding = f["claims_collected"] / f["months"] if f["months"] else 0
        if monthly_funding > 0 and f["cum_surplus"] / monthly_funding > 1.0:
            out.append((p, f["cum_surplus"] / monthly_funding))
    return out


def compute_supplement(cfg, computed):
    """Amortize a source plan's owned surplus across the renewal year to buy down the
    increase on a target plan.

    The plan account is an asset of the employer's plans in total. Funds sitting idle in
    one plan can be applied to another so long as they are used for the benefit of plan
    participants — which is exactly what offsetting a rate increase does.

    Mechanics: deploy `deploy_pct` (default 80%) of the source plan's accumulated surplus
    evenly across the 12 renewal months, leaving `retain_pct` (20%) as a year-end cushion.
    The deployed dollars are applied against the TARGET plan's projected incurred claims,
    so the target collects less from members while still being funded to its true cost.
    The credit is spread proportionally across tiers, preserving tier relativities.
    """
    s = cfg.get("surplus_supplement")
    if not s:
        return None
    by_name = {p["name"]: (p, d) for p, d in computed}
    src, dsrc = by_name[s["source_plan"]]
    tgt, dtgt = by_name[s["target_plan"]]

    deploy_pct = s.get("deploy_pct", 0.80)
    retain_pct = round(1.0 - deploy_pct, 4)
    cum = src["financials"]["cum_surplus"]
    deploy = cum * deploy_pct
    retain = cum * retain_pct

    rec_s = next(r for r in dsrc["rows"] if r["recommended"])
    rec_t = next(r for r in dtgt["rows"] if r["recommended"])

    # target: what it must be funded to, vs what it now collects from members
    cur_claims_yr = sum(tgt["enrollment"][t] * tgt["current_rates"]["claims"][t]
                        for t in tgt["tiers"]) * 12
    adequate = dtgt["adequate"]
    charged = adequate - deploy                      # collected from members
    mult = charged / cur_claims_yr if cur_claims_yr else 1.0
    net_with = mult - 1.0

    admin_t = dtgt["admin_new"]
    tiers_with = {t: round(tgt["current_rates"]["claims"][t] * mult, 2) + admin_t
                  for t in tgt["tiers"]}
    contract_mo = sum(tgt["enrollment"].values()) * 12
    credit_pepm = deploy / contract_mo if contract_mo else 0

    # program roll-up: current vs recommended vs recommended+supplement
    def prog(fn_s, fn_t):
        return (sum(src["enrollment"][t] * fn_s(t) for t in src["tiers"])
                + sum(tgt["enrollment"][t] * fn_t(t) for t in tgt["tiers"])) * 12
    cur_prog = prog(lambda t: src["current_rates"]["claims"][t] + src["current_rates"]["admin"],
                    lambda t: tgt["current_rates"]["claims"][t] + tgt["current_rates"]["admin"])
    prog_plain = prog(lambda t: rec_s["tiers"][t], lambda t: rec_t["tiers"][t])
    prog_supp = prog(lambda t: rec_s["tiers"][t], lambda t: tiers_with[t])

    return dict(
        src=src, tgt=tgt, dtgt=dtgt, cum=cum, deploy=deploy, retain=retain,
        deploy_pct=deploy_pct, retain_pct=retain_pct, monthly_draw=deploy / 12,
        months_held=cum / (src["financials"]["claims_collected"] / src["financials"]["months"]),
        adequate=adequate, charged=charged, credit_pepm=credit_pepm,
        net_plain=rec_t["net"], net_with=net_with,
        tiers_plain=rec_t["tiers"], tiers_with=tiers_with, admin=admin_t,
        src_reserve_plain=rec_s["end_reserve"],
        src_reserve_after=rec_s["end_reserve"] - deploy,
        cur_prog=cur_prog, prog_plain=prog_plain, prog_supp=prog_supp,
        chg_plain=prog_plain / cur_prog - 1, chg_supp=prog_supp / cur_prog - 1,
    )


def supplement_page(cfg, sup, page_no):
    src, tgt = sup["src"], sup["tgt"]
    rows = ""
    for t in tgt["tiers"]:
        cur = tgt["current_rates"]["claims"][t] + tgt["current_rates"]["admin"]
        rows += (f'<tr><td>{tgt["tier_labels"][t]}</td>'
                 f'<td class="num">{rate(cur)}</td>'
                 f'<td class="num">{rate(sup["tiers_plain"][t])}</td>'
                 f'<td class="num" style="font-weight:600">{rate(sup["tiers_with"][t])}</td></tr>')
    return f"""
<div class="page">
  {header([cfg['group_name'], f"Group {cfg['group_id']} · {cfg['program_coverage']}",
           "Supplement — Applying Your Owned Surplus"])}

  <h2 class="sec">Supplement — Putting Your Owned Surplus to Work</h2><div class="sec-rule"></div>

  <p>The recommendation on the previous pages prices each plan honestly to its own cost. But your
  plans do not exist in isolation: <b>the money in the plan account is an asset of the employer's
  plans in total.</b> You may direct those funds as you see fit, so long as they are used for the
  benefit of plan participants — and buying down a rate increase is precisely that.</p>

  <p>The <b>{src['name']}</b> plan is holding <b>{money(sup['cum'])}</b> of accumulated surplus —
  about <b>{sup['months_held']:.1f} months</b> of that plan's own claims funding. That is idle
  money. Meanwhile the <b>{tgt['name']}</b> plan needs an increase. This supplement applies the
  one to the other.</p>

  <h2 class="sec" style="margin-top:14px">How the Surplus Is Applied</h2><div class="sec-rule"></div>
  <div class="grid2">
    <div class="card"><h3>{src['name']} surplus — deployment</h3>
      <div class="kv"><span>Accumulated owned surplus</span><b class="num">{money(sup['cum'])}</b></div>
      <div class="kv"><span>Deployed across renewal year ({sup['deploy_pct']:.0%})</span><b class="num">{money(sup['deploy'])}</b></div>
      <div class="kv"><span>Amortized monthly draw</span><b class="num">{money(sup['monthly_draw'])}</b></div>
      <div class="kv"><span>Retained at year-end ({sup['retain_pct']:.0%})</span><b class="num">{money(sup['retain'])}</b></div>
    </div>
    <div class="card"><h3>{tgt['name']} — effect of the offset</h3>
      <div class="kv"><span>Projected claims to fund</span><b class="num">{money(sup['adequate'])}</b></div>
      <div class="kv"><span>Less surplus applied</span><b class="num">({money(sup['deploy'])[1:]})</b></div>
      <div class="kv"><span>Collected from members</span><b class="num">{money(sup['charged'])}</b></div>
      <div class="kv"><span>Credit per contract, per month</span><b class="num">{rate(sup['credit_pepm'])}</b></div>
    </div>
  </div>

  <div class="callout"><b>The {src['name']} rate does not change.</b> It stays at its Recommended
  (flat) rate and remains fully funded to its own projected claims. Only the <i>accumulated</i>
  surplus is deployed — {sup['deploy_pct']:.0%} of it, spread evenly over the twelve renewal
  months, leaving {money(sup['retain'])} in the account at year-end as a cushion.</div>

  <h2 class="sec" style="margin-top:12px">{tgt['name']} Rates — With the Surplus Applied</h2><div class="sec-rule"></div>
  <table>
    <thead><tr><th>Monthly rate by tier</th>
      <th>Current<br><span style="font-weight:400;font-size:8px">in force</span></th>
      <th>Recommended<br><span style="font-weight:400;font-size:8px">net {sup['net_plain']:+.0%}</span></th>
      <th>Recommended + Surplus<br><span style="font-weight:400;font-size:8px">net {sup['net_with']:+.0%}</span></th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
  <p class="disc" style="margin-top:6px">The {tgt['name']} plan is still funded to its full
  projected cost of {money(sup['adequate'])}; the difference is paid by the {src['name']} surplus
  rather than by members. The increase asked of members falls from
  <b>{sup['net_plain']:+.0%}</b> to <b>{sup['net_with']:+.0%}</b>.</p>

  <h2 class="sec" style="margin-top:12px">Combined Program Cost</h2><div class="sec-rule"></div>
  <table>
    <thead><tr><th>Annual funding collected</th><th>Amount</th><th>Change</th></tr></thead>
    <tbody>
      <tr><td>Current (in force)</td><td class="num">{money(sup['cur_prog'])}</td><td class="num">—</td></tr>
      <tr><td>Recommended — without supplement</td><td class="num">{money(sup['prog_plain'])}</td><td class="num">{sup['chg_plain']:+.1%}</td></tr>
      <tr class="rec"><td>Recommended — with surplus applied</td><td class="num">{money(sup['prog_supp'])}</td><td class="num">{sup['chg_supp']:+.1%}</td></tr>
    </tbody>
  </table>

  <div class="callout"><b>What this buys you.</b> Applying {money(sup['deploy'])} of the
  {src['name']} plan's owned surplus cuts the {tgt['name']} increase from
  {sup['net_plain']:+.0%} to {sup['net_with']:+.0%} and holds the whole program to
  {sup['chg_supp']:+.1%} — instead of {sup['chg_plain']:+.1%} — with no benefit reduction on either
  plan and {money(sup['retain'])} still in reserve at year-end. This is a one-year measure: the
  surplus is spent once, and the {tgt['name']} plan's underlying cost remains what it is. If the
  district prefers to keep the surplus intact, the unsupplemented rates on the preceding pages
  stand.</div>

  <p class="disc"><b>Note.</b> Plan funds must be used for the exclusive benefit of plan
  participants. Offsetting participant rates qualifies; the district should confirm the approach
  with its own counsel and reflect it in the plan documents.</p>

  {footer(page_no, cfg['total_pages'], cfg)}
</div>"""


def css():
    return f"""
@page {{ size: letter; margin: 0; }}
* {{ box-sizing: border-box; }}
body {{ margin:0; color:{T['ink']}; font-family:"Helvetica Neue",Arial,sans-serif;
        -webkit-print-color-adjust:exact; print-color-adjust:exact; }}
.page {{ width:8.5in; min-height:11in; height:11in; overflow:hidden;
         page-break-after:always; padding:0.62in 0.7in; position:relative;
         background:{T['paper']}; }}
.page:last-child {{ page-break-after:auto; }}
h1,h2,h3,.serif {{ font-family:Georgia,"Times New Roman",serif; }}
.num {{ font-variant-numeric:tabular-nums; }}
.wm {{ height:34px; width:auto; }}

.rh {{ display:flex; justify-content:space-between; align-items:center;
       border-bottom:1px solid {T['rule']}; padding-bottom:10px; margin-bottom:22px; }}
.rh .ctx {{ font-size:9px; letter-spacing:1.4px; color:{T['muted']};
            text-transform:uppercase; text-align:right; line-height:1.5; }}
.pf {{ position:absolute; left:0.7in; right:0.7in; bottom:0.45in;
       border-top:1px solid {T['rule']}; padding-top:8px; font-size:8px;
       color:{T['muted']}; display:flex; justify-content:space-between; letter-spacing:.5px; }}

.cover {{ background:{T['green_deep']}; color:#fff; }}
.cover .pill {{ background:#fff; display:inline-block; padding:9px 16px; border-radius:30px; }}
.cover .kick {{ margin-top:2.6in; font-size:11px; letter-spacing:3px; text-transform:uppercase;
                color:#bfe3d8; }}
.cover h1 {{ font-size:40px; line-height:1.08; margin:14px 0 6px; font-weight:600; }}
.cover .sub {{ font-size:15px; color:#dcefe8; }}
.cover .meta {{ position:absolute; left:0.7in; bottom:0.9in; font-size:11px; color:#cfe6de;
                letter-spacing:.6px; line-height:1.9; }}
.cover .meta b {{ color:#fff; font-weight:600; }}
.cover .bar {{ position:absolute; left:0; right:0; bottom:0; height:10px; background:{T['gold']}; }}

h2.sec {{ font-size:15px; color:{T['green_deep']}; margin:0 0 4px; letter-spacing:.3px; }}
.sec-rule {{ height:2px; width:38px; background:{T['gold']}; margin:0 0 12px; }}
p {{ font-size:11px; line-height:1.55; margin:0 0 9px; }}
.lead {{ font-size:11.5px; }}
.grid2 {{ display:flex; gap:16px; }}
.card {{ border:1px solid {T['rule']}; border-radius:6px; padding:13px 15px; flex:1; }}
.card h3 {{ font-size:11px; letter-spacing:1px; text-transform:uppercase;
            color:{T['muted']}; margin:0 0 8px; }}
.kv {{ display:flex; justify-content:space-between; font-size:10.5px; padding:3px 0;
       border-bottom:1px dotted {T['rule']}; }}
.kv:last-child {{ border-bottom:none; }}
.kv b {{ color:{T['green_deep']}; }}
.callout {{ background:{T['green_pale']}; border-left:3px solid {T['green']};
            padding:11px 14px; border-radius:0 6px 6px 0; font-size:10.5px;
            line-height:1.5; margin:12px 0; }}
.callout b {{ color:{T['green_deep']}; }}

table {{ width:100%; border-collapse:collapse; font-size:10.5px; }}
thead th {{ background:{T['green_deep']}; color:#fff; font-weight:600; text-align:right;
            padding:7px 9px; font-size:9.5px; letter-spacing:.4px; }}
thead th:first-child {{ text-align:left; }}
tbody td {{ padding:6px 9px; text-align:right; border-bottom:1px solid {T['rule']}; }}
tbody td:first-child {{ text-align:left; color:{T['muted']}; }}
tbody tr.rec td {{ background:{T['green_pale']}; }}
tbody tr.rec td:first-child {{ font-weight:600; color:{T['green_deep']}; }}
.scen-head {{ display:flex; gap:10px; margin:2px 0 10px; }}
.scen {{ flex:1; border:1px solid {T['rule']}; border-radius:6px; padding:10px 12px; }}
.scen.rec {{ border-color:{T['green']}; box-shadow:inset 0 0 0 1px {T['green']}; }}
.scen .tag {{ font-size:8px; letter-spacing:1px; text-transform:uppercase;
              color:{T['gold']}; font-weight:700; }}
.scen .nm {{ font-size:12px; font-family:Georgia,serif; color:{T['green_deep']}; margin:2px 0 5px; }}
.scen .bl {{ font-size:9.5px; line-height:1.45; color:{T['ink']}; }}
.disc {{ font-size:8.5px; color:{T['muted']}; line-height:1.5; }}
.disc b {{ color:{T['green_deep']}; }}
.freedom {{ font-style:italic; color:{T['green_deep']}; font-size:10px; }}

/* --- program-overview & about pages (ported from the 7-page format) --- */
.lead {{ font-size:11.5px; }}
tbody tr.tot td {{ font-weight:700; color:{T['green_deep']};
        border-top:2px solid {T['green_deep']}; }}
.statrow {{ display:flex; gap:12px; margin:14px 0; }}
.stat {{ flex:1; border:1px solid {T['rule']}; border-radius:6px; padding:12px; text-align:center; }}
.stat .v {{ font-family:Georgia,serif; font-size:19px; color:{T['green_deep']}; }}
.stat .l {{ font-size:8px; letter-spacing:1px; text-transform:uppercase;
        color:{T['muted']}; margin-top:3px; }}

/* ---- acceptance page ---- */
.box {{ width:13px; height:13px; border:1.4px solid {T['green_deep']}; border-radius:2px;
        display:inline-block; flex:none; margin-right:10px; background:#fff;
        vertical-align:-2px; }}
table.elect thead th {{ text-align:center; line-height:1.3; }}
table.elect thead th:first-child {{ text-align:left; }}
table.elect tbody td {{ text-align:center; padding:8px 6px; vertical-align:middle; }}
table.elect tbody td:first-child {{ text-align:left; color:{T['ink']};
        font-family:Georgia,serif; font-size:11.5px; color:{T['green_deep']}; }}
.plab {{ font-size:9px; letter-spacing:1.4px; text-transform:uppercase; color:{T['muted']};
         margin:6px 0 4px; font-weight:700; }}
.terms {{ border:1px solid {T['rule']}; border-left:3px solid {T['gold']}; border-radius:0 6px 6px 0;
          padding:8px 12px; font-size:9px; line-height:1.45; margin:8px 0; }}
.sig {{ display:flex; gap:22px; margin-top:4px; }}
.sig .f {{ flex:1; }}
.sig .ln {{ border-bottom:1px solid {T['ink']}; height:21px; }}
.sig small {{ font-size:8px; letter-spacing:1.2px; text-transform:uppercase;
              color:{T['muted']}; display:block; margin-top:4px; }}
.ret {{ background:{T['green_deep']}; color:#fff; border-radius:6px; padding:8px 14px;
        text-align:center; margin-top:10px; }}
.ret .lbl {{ font-size:8px; letter-spacing:2px; text-transform:uppercase; color:#bfe3d8; }}
.ret .em {{ font-family:Georgia,serif; font-size:15px; margin-top:2px; }}
"""


def header(ctx_lines):
    return f'<div class="rh">{LOGO_SVG}<div class="ctx">{"<br>".join(ctx_lines)}</div></div>'


def footer(page_no, total, cfg):
    return (f'<div class="pf"><span>Simple Benefits · administered by 90 Degree Benefits</span>'
            f'<span>{cfg["group_name"]} — Renewal · Page {page_no} of {total}</span></div>')


# ----------------------------------------------------------------------------
# PAGES
# ----------------------------------------------------------------------------
def cover(cfg):
    return f"""
<div class="page cover">
  <div class="pill">{LOGO_SVG}</div>
  <div class="kick">Self-Funded {cfg['program_coverage']} · Renewal Proposal</div>
  <h1>{cfg['group_name']}</h1>
  <div class="sub">{cfg['cover_plans']} &nbsp;·&nbsp; Group {cfg['group_id']}</div>
  <div class="meta">
    <div><b>Renewal effective</b> &nbsp; {cfg['renewal_effective']}</div>
    <div><b>Current plan year</b> &nbsp; {cfg['plan_year']}</div>
    <div><b>Prepared</b> &nbsp; {cfg['prepared_date']}</div>
    <div><b>Prepared for</b> &nbsp; {cfg['prepared_for']}</div>
  </div>
  <div class="bar"></div>
</div>"""


def summary_page(cfg, plan, d, page_no):
    f = plan["financials"]; a = plan["assumptions"]; des = plan["design"]
    rec = next(r for r in d["rows"] if r["recommended"])
    # Admin-fee clause is sign-aware: the fee usually steps UP for inflation, but it can
    # hold flat or step DOWN (e.g. broker compensation removed). The net change equals
    # admin_bump + broker_comp.
    _abump = a["admin_bump"] + a.get("broker_comp", 0)
    if _abump > 0.005:
        admin_clause = f"which rises {rate(_abump)} this year to offset inflation"
    elif _abump < -0.005:
        admin_clause = f"which is reduced {rate(abs(_abump))} this year"
    else:
        admin_clause = "unchanged this year"
    design_rows = "".join(f'<div class="kv"><span>{k}</span><b>{v}</b></div>' for k, v in des.items())
    enroll_rows = "".join(
        f'<div class="kv"><span>{plan["tier_labels"][t]}</span>'
        f'<b class="num">{plan["enrollment"][t]:.0f}</b></div>' for t in plan["tiers"])

    return f"""
<div class="page">
  {header([cfg['group_name'], f"Group {cfg['group_id']} · {plan['name']}", cfg['renewal_effective']])}

  <p class="lead">Thank you for being a Simple client. The summary below explains how the
  <b>{plan['name']}</b> plan performed this year and what we recommend for the renewal —
  and, just as important, <i>why</i>. Everything ties back to one principle: your rate is
  projected claims plus a flat administrative fee, with <b>100% of unused funds owned by the plan.</b></p>

  <h2 class="sec">Your Plan</h2><div class="sec-rule"></div>
  <div class="grid2">
    <div class="card"><h3>{plan['name']} · {plan['coverage']}</h3>{design_rows}</div>
    <div class="card"><h3>Enrollment (avg)</h3>{enroll_rows}
      <div class="kv"><span>Total contracts</span><b class="num">{d['subs']:.0f}</b></div>
    </div>
  </div>

  <h2 class="sec" style="margin-top:16px">Financial Summary — How the Year Went</h2><div class="sec-rule"></div>
  <div class="grid2">
    <div class="card"><h3>This year to date ({f['months']} mo)</h3>
      <div class="kv"><span>Claims funding collected</span><b class="num">{money(f['claims_collected'])}</b></div>
      <div class="kv"><span>Claims paid</span><b class="num">{money(f['claims_paid'])}</b></div>
      <div class="kv"><span>Claims loss ratio (as paid)</span><b class="num">{f['loss_ratio']:.0%}</b></div>
      <div class="kv"><span>Plan-owned surplus (yr)</span><b class="num">{money(f['current_surplus'])}</b></div>
    </div>
    <div class="card"><h3>Owned funds &amp; trend</h3>
      <div class="kv"><span>Prior-year result</span><b class="num">{money(f['prior_surplus'])}</b></div>
      <div class="kv"><span>Owned surplus (this plan)</span><b class="num">{money(f['cum_surplus'])}</b></div>
      <div class="kv"><span>≈ months of claims held</span><b class="num">{f['cum_surplus']/d['mo_paid']:.1f}</b></div>
      <div class="kv"><span>{cfg['program_coverage']} trend applied</span><b class="num">{a['trend']:.0%}</b></div>
    </div>
  </div>

  <div class="callout"><b>Read on adequacy.</b> {plan['adequacy_note']}</div>

  <div class="callout" style="border-left-color:{T['gold']}; background:#faf5ea">
    <b>Benefits.</b> {plan['benefit_note']} We never propose reducing benefits; where a plan
    runs short we ask for additional funding, and where a maximum has sat unchanged too long we
    suggest raising it so the plan keeps paying its share of rising claims.
  </div>

  <h2 class="sec" style="margin-top:14px">What We Recommend</h2><div class="sec-rule"></div>
  <p>Our recommendation is <b>{rec['name']}</b> — a net <b>{rec['net']:+.0%}</b> change to the
  claims rate, bringing the employee-only rate to <b>{rate(rec['tiers'][plan['tiers'][0]])}</b> per
  month and holding roughly {money(rec['end_reserve'])} (~{rec['reserve_mo']:.1f} months of claims)
  in reserve. Every tier is built the same way — projected claims plus the {rate(d['admin_new'])}
  administrative fee, {admin_clause}. Full tier
  rates and all three options are on the next page.</p>

  {footer(page_no, cfg['total_pages'], cfg)}
</div>"""


def scenarios_page(cfg, plan, d, page_no):
    a = plan["assumptions"]
    cards = ""
    for r in d["rows"]:
        cls = "scen rec" if r["recommended"] else "scen"
        tag = "Recommended" if r["recommended"] else r["tag"]
        cards += (f'<div class="{cls}"><div class="tag">{tag}</div>'
                  f'<div class="nm">{r["name"]}</div><div class="bl">{r["blurb"]}</div></div>')
    # Current (in-force) rate = current claims + current admin, shown first for easy
    # comparison against the three options. Renewal-only: new-business proposals use a
    # different generator and have no in-force rate.
    cur_admin = plan["current_rates"]["admin"]
    body = ""
    for t in plan["tiers"]:
        cur_cell = f'<td class="num">{rate(plan["current_rates"]["claims"][t] + cur_admin)}</td>'
        cells = "".join(f'<td class="num">{rate(r["tiers"][t])}</td>' for r in d["rows"])
        body += f'<tr><td>{plan["tier_labels"][t]}</td>{cur_cell}{cells}</tr>'
    pos = (f'<td class="num" style="color:{T["muted"]}">—</td>' + "".join(
        f'<td class="num">{money(r["end_reserve"])}'
        f'<br><span style="font-size:8px;color:{T["muted"]}">~{r["reserve_mo"]:.1f} mo</span></td>'
        for r in d["rows"]))
    heads = ('<th>Current'
             '<br><span style="font-weight:400;font-size:8px">in force</span></th>') + "".join(
        f'<th>{r["name"].split("(")[0].strip()}'
        f'<br><span style="font-weight:400;font-size:8px">net {r["net"]:+.0%}</span></th>'
        for r in d["rows"])

    # --- config-driven prose (nothing group- or coverage-specific hardcoded below) ---
    n_plans = len(cfg["plans"])
    cov = cfg["program_coverage"].lower()
    share_phrase = (f"this plan's share of the district's owned {cov} account"
                    if n_plans > 1 else f"the plan's owned {cov} account")
    pooled = pooled_note(cfg, n_plans)
    basis = f" {plan['basis_note']}" if plan.get("basis_note") else ""

    return f"""
<div class="page">
  {header([cfg['group_name'], f"Group {cfg['group_id']} · {plan['name']}", "Renewal-year rate options"])}

  <h2 class="sec">Projected Renewal Costs — Three Options</h2><div class="sec-rule"></div>
  <p>All three options start from the same true cost of the plan (projected claims + a
  {rate(d['admin_new'])} administrative fee). They differ only in <b>how much of your owned
  surplus we apply</b> to {plan['options_axis']} — which changes both your monthly cost and how
  much reserve you keep against a heavy claims year.</p>

  <div class="scen-head">{cards}</div>

  <table>
    <thead><tr><th>Monthly rate by tier</th>{heads}</tr></thead>
    <tbody>
      {body}
      <tr class="rec"><td>Projected year-end reserve</td>{pos}</tr>
    </tbody>
  </table>
  <p class="disc" style="margin-top:6px">Reserve = {share_phrase}
  ({money(d['surplus'])}) adjusted for the projected claims shortfall or overage each option
  leaves. Projected incurred claims for the renewal year ≈ {money(d['adequate'])}.{pooled}</p>

  <div class="callout"><b>Which to choose.</b> {plan['which_note']}</div>

  <h2 class="sec" style="margin-top:12px">Basis of Projection</h2><div class="sec-rule"></div>
  <p class="disc">Anchored to this plan's own {plan['financials']['months']}-month claims
  experience from the Plan Performance Report and the prior plan year, completed for claims
  incurred but not yet paid, and trended {a['trend']:.0%} to the renewal year.{basis} Because the
  group is small, indicated results are credibility-tempered rather than taken raw. Enrollment held
  at current average; the {rate(d['admin_new'])} administrative fee includes broker compensation if
  requested by the broker.</p>

  <p class="freedom">{freedom_note(cfg['program_coverage'])}</p>

  {footer(page_no, cfg['total_pages'], cfg)}
</div>"""


def overview_page(cfg, computed, page_no):
    """Program roll-up: combined annual cost across plans, plus the owned-funds narrative.

    Rendered only for multi-plan programs — for a single plan it would restate the
    summary page. All prose is config-driven (`overview_lead`, `program_notes`,
    `program_cost_note`, `owned_funds_note`); only the cost table is computed.
    """
    body = ""
    cur_tot = new_tot = 0.0
    for plan, d in computed:
        rec = next(r for r in d["rows"] if r["recommended"])
        cur_annual = sum(plan["enrollment"][t] * (plan["current_rates"]["claims"][t]
                         + plan["current_rates"]["admin"]) for t in plan["tiers"]) * 12
        new_annual = sum(plan["enrollment"][t] * rec["tiers"][t] for t in plan["tiers"]) * 12
        cur_tot += cur_annual
        new_tot += new_annual
        body += (f'<tr><td>{plan["name"]}</td>'
                 f'<td class="num">{money(cur_annual)}</td>'
                 f'<td class="num">{money(new_annual)}</td>'
                 f'<td class="num">{new_annual / cur_annual - 1:+.1%}</td></tr>')
    body += (f'<tr class="tot"><td>Combined program</td>'
             f'<td class="num">{money(cur_tot)}</td>'
             f'<td class="num">{money(new_tot)}</td>'
             f'<td class="num">{new_tot / cur_tot - 1:+.1%}</td></tr>')

    n = len(computed)
    cov = cfg["program_coverage"].lower()
    lead = cfg.get("overview_lead") or (
        f"Thank you for being a Simple client. This proposal covers "
        f"{'both' if n == 2 else 'all %d' % n} of your {cov} plans for the "
        f"{cfg['renewal_effective']} renewal, and explains not just the numbers but the "
        f"reasoning behind them. Everything ties back to one principle: your rate is projected "
        f"claims plus a flat administrative fee \u2014 no margin, no reserves, no stop-loss, no "
        f"taxes \u2014 with <b>100% of unused funds owned by the plan.</b>")

    notes = ""
    for nt in cfg.get("program_notes", []):
        style = ('style="border-left-color:%s; background:#faf5ea"' % T["gold"]
                 if nt.get("accent") == "gold" else "")
        notes += f'<div class="callout" {style}><b>{nt["title"]}</b> {nt["body"]}</div>'

    owned = cfg.get("owned_funds_note", "")
    owned_block = (f'<div class="callout"><b>About your owned funds.</b> {owned}</div>'
                   if owned else "")

    return f"""
<div class="page">
  {header([cfg['group_name'], f"Group {cfg['group_id']} \u00b7 {cfg['program_coverage']}",
           "Program overview"])}

  <h2 class="sec">Your Renewal \u2014 In Brief</h2><div class="sec-rule"></div>
  <p class="lead">{lead}</p>

  <p>Each plan is priced to its own experience rather than blended together:</p>
  {notes}

  <h2 class="sec" style="margin-top:14px">Recommended Program Cost</h2><div class="sec-rule"></div>
  <table>
    <thead><tr><th>Annual funding</th><th>Current</th><th>Proposed</th><th>Change</th></tr></thead>
    <tbody>{body}</tbody>
  </table>
  <p class="disc" style="margin-top:6px">{cfg.get('program_cost_note', '')}</p>

  {owned_block}

  {footer(page_no, cfg['total_pages'], cfg)}
</div>"""


def about_page(cfg, page_no):
    """About Simple Benefits + the six verbatim disclosures + contacts."""
    n = len(cfg["plans"])
    cov = cfg["program_coverage"]
    disc6 = cfg.get("disclosure_6") or default_disclosure_6(cov)
    stat_label = f"{cov} plan{'s' if n != 1 else ''}, priced to own cost"

    return f"""
<div class="page">
  {header([cfg['group_name'], f"Group {cfg['group_id']} \u00b7 {cov}", "About & disclosures"])}

  <h2 class="sec">About Simple Benefits</h2><div class="sec-rule"></div>
  <p>Simple Benefits builds self-funded dental and vision programs on a single idea: strip out
  everything that isn't a claim or a flat administrative fee, and give the plan back everything it
  doesn't spend. Your plans are administered by <b>90 Degree Benefits</b>, a Blue Cross and Blue
  Shield of Alabama business unit, from its Bossier City, Louisiana office.</p>

  <div class="statrow">
    <div class="stat"><div class="v num">$0</div><div class="l">Risk margin</div></div>
    <div class="stat"><div class="v num">100%</div><div class="l">Unused funds owned by plan</div></div>
    <div class="stat"><div class="v num">Any</div><div class="l">Licensed provider, no network</div></div>
    <div class="stat"><div class="v num">{n}</div><div class="l">{stat_label}</div></div>
  </div>

  <h2 class="sec" style="margin-top:10px">Disclosures</h2><div class="sec-rule"></div>
  <p class="disc">
  1. These figures are <b>projections</b>. This is a self-funded plan and <b>is not insurance</b>;
     exposure on any one covered person is capped by the annual maximum benefit.<br>
  2. Monthly rates are <b>recommendations only</b>. Actual claims vary and <b>additional amounts
     may be required in any month</b> to fund claims.<br>
  3. <b>100% of any unused claim funds are owned by the plan.</b><br>
  4. Rates contain <b>no margin, no runout reserves, no stop-loss, and no taxes</b> \u2014 only
     projected claims plus the administrative fee.<br>
  5. The administrative fee <b>includes compensation to the broker if requested by the broker.</b><br>
  6. {disc6}
  </p>

  <h2 class="sec" style="margin-top:10px">Contacts</h2><div class="sec-rule"></div>
  <p class="disc">Your Simple Benefits service team, together with your broker of record, is
  available for any questions on this renewal and to walk the committee through the options and
  the owned-surplus decision.</p>

  {footer(page_no, cfg['total_pages'], cfg)}
</div>"""


def _accept_block(plan, d, uniform_admin, multi):
    """One plan's rate-election table for the acceptance page."""
    rows = ""
    for r in d["rows"]:
        cls = ' class="rec"' if r["recommended"] else ""
        nm = r["name"].split("(")[0].strip()
        badge = ('<span style="font-size:7.5px;letter-spacing:.8px;color:%s"> · RECOMMENDED</span>'
                 % T["gold"]) if r["recommended"] and nm.lower() != "recommended" else ""
        cells = "".join(f'<td class="num">{rate(r["tiers"][t])}</td>' for t in plan["tiers"])
        rows += (f'<tr{cls}><td><span class="box"></span>{nm}{badge}'
                 f'<div style="font-size:8px;color:{T["muted"]};margin-left:23px">'
                 f'net {r["net"]:+.0%} claims · reserve {money(r["end_reserve"])}</div></td>'
                 f'{cells}</tr>')
    th = "".join(f'<th>{plan["tier_heads"][t]}</th>' for t in plan["tiers"])
    fee = "" if uniform_admin else f' &nbsp;·&nbsp; includes {rate(d["admin_new"])} admin fee'
    lbl = (f'<div class="plab">{plan["name"]} Plan — {plan["coverage"]}{fee}</div>'
           if multi else "")
    return (f'{lbl}<table class="elect">'
            f'<thead><tr><th>Option</th>{th}</tr></thead><tbody>{rows}</tbody></table>')


def _accept_benefits(cfg, computed, multi):
    """Section 2 benefit-changes block (factual list, not a menu)."""
    if any(plan.get("benefit_changes") for plan, _ in computed):
        bsec = ('<p class="disc" style="margin-bottom:6px">The following benefit changes apply to '
                'the renewal plan. Your signature below confirms agreement to these changes.</p>')
        for plan, _ in computed:
            ch = plan.get("benefit_changes", [])
            if not ch:
                continue
            crows = "".join(
                f'<tr><td>{c["item"]}</td><td class="num">{c["current"]}</td>'
                f'<td class="num" style="color:{T["green_deep"]};font-weight:600">{c["renewal"]}</td></tr>'
                for c in ch)
            if multi:
                bsec += f'<div class="plab">{plan["name"]} Plan</div>'
            bsec += ('<table><thead><tr><th>Benefit</th><th>Current Plan</th>'
                     f'<th>Renewal Plan</th></tr></thead><tbody>{crows}</tbody></table>')
        return bsec
    return ('<p class="disc"><b>No benefit changes are proposed for the renewal year.</b> '
            'The plan design shown in this proposal continues unchanged.</p>')


def _accept_terms_auth():
    """Continuation terms + authorization + return banner (shared tail)."""
    return f"""
  <div class="terms">
    If a signed copy of this acceptance is not received within <b>10 days of the plan anniversary</b>,
    90 Degree Benefits will continue the <b>current plan at the current claim funding rates</b>, but
    will apply any increase in administrative fees requested as indicated in the
    <b>Administrative Services Agreement (ASA)</b>.
  </div>

  <h2 class="sec" style="margin-top:4px">3. Authorization</h2><div class="sec-rule"></div>
  <div class="sig">
    <div class="f" style="flex:1.5"><div class="ln"></div><small>Company Name</small></div>
    <div class="f"><div class="ln"></div><small>Date</small></div>
  </div>
  <div class="sig" style="margin-top:8px">
    <div class="f" style="flex:1.5"><div class="ln"></div><small>Authorized Signature</small></div>
    <div class="f"><div class="ln"></div><small>Title</small></div>
  </div>

  <div class="ret">
    <div class="lbl">Please return this signed page by email to</div>
    <div class="em">docs@simple.us</div>
  </div>"""


def acceptance_page(cfg, computed, page_no):
    """Signature page: rate election (all tiers), benefit changes as applied, terms, signature.

    Per addendum §9a this page is the client's ACCEPTANCE. It is not a menu.
    Section 2 lists only the benefit changes that actually apply to the renewal
    plan (`plan["benefit_changes"]`); the signature confirms agreement to them.
    An empty list prints the "no changes proposed" line.

    A program of more than three plans (e.g. Ware County's six) will not fit a
    single acceptance sheet, so the election paginates: the rate tables run across
    two pages and the benefit/terms/authorization tail closes the second. Programs
    of three plans or fewer render on one page exactly as before.
    """
    multi = len(computed) > 1
    admins = {d["admin_new"] for _, d in computed}
    uniform_admin = len(admins) == 1
    blocks_list = [_accept_block(p, d, uniform_admin, multi) for p, d in computed]
    bsec = _accept_benefits(cfg, computed, multi)
    plan_names = ", ".join(f"{p['name']} ({p['coverage']})" for p in cfg["plans"])
    admin_line = (
        f"include the {rate(next(iter(admins)))} administrative fee" if uniform_admin
        else "include that plan's administrative fee, shown with each plan below")

    id_cards = f"""<div class="grid2" style="margin-bottom:10px">
    <div class="card" style="padding:9px 14px">
      <div class="kv"><span>Client</span><b>{cfg['group_name']}</b></div>
      <div class="kv"><span>Group</span><b>{cfg['group_id']}</b></div>
    </div>
    <div class="card" style="padding:9px 14px">
      <div class="kv"><span>Plan(s)</span><b>{plan_names}</b></div>
      <div class="kv"><span>Renewal effective</span><b>{cfg['renewal_effective']}</b></div>
    </div>
  </div>"""

    # -- single-page path (<=3 plans): unchanged output --
    if len(computed) <= 3:
        return f"""
<div class="page">
  {header([cfg['group_name'], f"Group {cfg['group_id']}", "Renewal acceptance"])}

  <h2 class="sec">Renewal Acceptance</h2><div class="sec-rule"></div>
  {id_cards}

  <h2 class="sec">1. Select Your Renewal Rates</h2><div class="sec-rule"></div>
  <p class="disc" style="margin-bottom:6px">Check <b>one</b> option per plan. Rates shown are
  monthly, per contract, and {admin_line}.</p>
  {"".join(blocks_list)}

  <h2 class="sec" style="margin-top:16px">2. Benefit Changes</h2><div class="sec-rule"></div>
  {bsec}
  {_accept_terms_auth()}

  {footer(page_no, cfg['total_pages'], cfg)}
</div>"""

    # -- two-page path (>3 plans): split the election, tail on the second page --
    half = (len(blocks_list) + 1) // 2
    page_a = f"""
<div class="page">
  {header([cfg['group_name'], f"Group {cfg['group_id']}", "Renewal acceptance"])}

  <h2 class="sec">Renewal Acceptance</h2><div class="sec-rule"></div>
  {id_cards}

  <h2 class="sec">1. Select Your Renewal Rates</h2><div class="sec-rule"></div>
  <p class="disc" style="margin-bottom:6px">Check <b>one</b> option per plan. Rates shown are
  monthly, per contract, and {admin_line}. The rate election continues on the next page.</p>
  {"".join(blocks_list[:half])}

  {footer(page_no, cfg['total_pages'], cfg)}
</div>"""
    page_b = f"""
<div class="page">
  {header([cfg['group_name'], f"Group {cfg['group_id']}", "Renewal acceptance (continued)"])}

  <h2 class="sec">1. Select Your Renewal Rates <span style="font-size:10px;color:{T['muted']}">(continued)</span></h2>
  <div class="sec-rule"></div>
  {"".join(blocks_list[half:])}

  <h2 class="sec" style="margin-top:14px">2. Benefit Changes</h2><div class="sec-rule"></div>
  {bsec}
  {_accept_terms_auth()}

  {footer(page_no + 1, cfg['total_pages'], cfg)}
</div>"""
    return page_a + page_b


def build_html(cfg):
    computed = [(p, compute(p)) for p in cfg["plans"]]
    n = len(computed)
    show_overview = cfg.setdefault("include_overview", n > 1)
    sup = compute_supplement(cfg, computed)
    # cover + [overview] + 2 per plan + [supplement] + about + acceptance (2 pages when >3 plans)
    accept_pages = 2 if n > 3 else 1
    cfg["total_pages"] = (3 + 2 * n + (1 if show_overview else 0)
                          + (1 if sup else 0) + (accept_pages - 1))
    # Derived, not hand-typed — the cover can never disagree with the plans it lists.
    cfg.setdefault("cover_plans", cover_plans_line(cfg))
    # Pooled account = sum of each plan's allocated share, unless explicitly overridden.
    cfg.setdefault("program_surplus",
                   sum(p["financials"]["cum_surplus"] for p in cfg["plans"]))

    pages = cover(cfg)
    pno = 2
    if show_overview:
        pages += overview_page(cfg, computed, pno); pno += 1
    for plan, d in computed:
        pages += summary_page(cfg, plan, d, pno); pno += 1
        pages += scenarios_page(cfg, plan, d, pno); pno += 1
    if sup:
        pages += supplement_page(cfg, sup, pno); pno += 1
    pages += about_page(cfg, pno); pno += 1
    pages += acceptance_page(cfg, computed, pno)
    return f"<!doctype html><html><head><meta charset='utf-8'><style>{css()}</style></head><body>{pages}</body></html>"


# ----------------------------------------------------------------------------
# VALIDATION — the input contract. The CMS should run this before rendering.
# Fail loudly on a bad config rather than shipping a wrong signature page.
# ----------------------------------------------------------------------------
PROGRAM_REQUIRED = ["group_name", "group_id", "program_coverage", "prepared_date",
                    "renewal_effective", "plan_year", "prepared_for", "plans"]
PLAN_REQUIRED = ["name", "coverage", "tiers", "tier_labels", "tier_heads", "design",
                 "enrollment", "current_rates", "financials", "assumptions",
                 "adequacy_note", "benefit_note", "options_axis", "which_note",
                 "benefit_changes", "scenarios"]
FIN_REQUIRED = ["months", "paid_months", "claims_collected", "claims_paid",
                "loss_ratio", "current_surplus", "prior_surplus", "cum_surplus"]
ASSUMP_REQUIRED = ["trend", "adequacy_pct", "admin_bump", "broker_comp"]
COVERAGES = ("Dental", "Vision", "Dental & Vision")
# Standard annual admin-fee inflation step, per coverage (addendum §7). Deviations are
# allowed (broker comp is folded into admin) but are surfaced as a non-fatal advisory.
ADMIN_STEP = {"Dental": 0.40, "Vision": 0.25}


def validate(cfg):
    """Return a list of problems. Empty list == safe to render."""
    e = []
    for k in PROGRAM_REQUIRED:
        if k not in cfg:
            e.append(f"program: missing '{k}'")
    if cfg.get("program_coverage") not in COVERAGES:
        e.append(f"program: program_coverage must be one of {COVERAGES}")
    if not cfg.get("plans"):
        return e + ["program: 'plans' is empty"]

    n = len(cfg["plans"])
    if n > 1:
        for k in ("program_notes", "program_cost_note", "owned_funds_note"):
            if cfg.get("include_overview", True) and not cfg.get(k):
                e.append(f"program: multi-plan needs '{k}' for the overview page")
        if cfg.get("program_notes") and len(cfg["program_notes"]) != n:
            e.append(f"program: {len(cfg['program_notes'])} program_notes for {n} plans")
    if "Dental" in cfg.get("program_coverage", "") and not cfg.get("disclosure_6"):
        e.append("program: dental programs must set disclosure_6 explicitly (orthodontia scope)")

    covs = {p.get("coverage") for p in cfg["plans"]}
    if cfg.get("program_coverage") == "Dental & Vision" and covs == {"Dental"}:
        e.append("program: program_coverage says 'Dental & Vision' but no vision plan")

    for i, p in enumerate(cfg["plans"]):
        tag = f"plan[{i}] {p.get('name', '?')}"
        for k in PLAN_REQUIRED:
            if k not in p:
                e.append(f"{tag}: missing '{k}'")
        if not all(k in p for k in ("tiers", "tier_labels", "tier_heads",
                                    "enrollment", "current_rates")):
            continue
        for t in p["tiers"]:
            for d, nm in ((p["tier_labels"], "tier_labels"), (p["tier_heads"], "tier_heads"),
                          (p["enrollment"], "enrollment"),
                          (p["current_rates"]["claims"], "current_rates.claims")):
                if t not in d:
                    e.append(f"{tag}: tier '{t}' missing from {nm}")
        fin = p.get("financials", {})
        for k in FIN_REQUIRED:
            if k not in fin:
                e.append(f"{tag}: financials missing '{k}'")
        if fin.get("paid_months", 1) > fin.get("months", 0):
            e.append(f"{tag}: paid_months ({fin.get('paid_months')}) > months ({fin.get('months')})")
        # A partial paid window (e.g. front-of-year lag / held claims) MUST be explained,
        # so the reader knows why the monthly-claims denominator differs from the term.
        if fin.get("paid_months", fin.get("months", 0)) < fin.get("months", 0) \
                and not p.get("basis_note"):
            e.append(f"{tag}: paid_months < months requires a basis_note explaining the "
                     f"partial-year read (front-of-year lag / seasonality)")
        a = p.get("assumptions", {})
        for k in ASSUMP_REQUIRED:
            if k not in a:
                e.append(f"{tag}: assumptions missing '{k}'")
        recs = [s for s in p.get("scenarios", []) if s.get("recommended")]
        if len(recs) != 1:
            e.append(f"{tag}: needs exactly one scenario marked recommended, found {len(recs)}")
        for s in p.get("scenarios", []):
            for k in ("key", "name", "net_claims_pct"):
                if k not in s:
                    e.append(f"{tag}: scenario {s.get('name', s.get('key', '?'))} missing '{k}'")
        keys = [s.get("key") for s in p.get("scenarios", [])]
        if len(keys) != len(set(keys)):
            e.append(f"{tag}: scenario keys must be unique, got {keys}")
        # Scenario-spread floor (addendum §8): Value and Protective must bracket the
        # Recommended net by at least ±5 percentage points on EACH side. A tighter spread
        # (pennies apart at the tier level) gives the employer and broker no real choice —
        # the three-option frame is only worth showing if the options are visibly different.
        if len(recs) == 1:
            rn = recs[0].get("net_claims_pct")
            nets = [s.get("net_claims_pct") for s in p.get("scenarios", [])
                    if "net_claims_pct" in s]
            if rn is not None and nets:
                if not any(n <= rn - 0.05 + 1e-9 for n in nets):
                    e.append(f"{tag}: needs a scenario at least 5 pts BELOW Recommended "
                             f"(min spread §8); lowest {min(nets):+.0%} vs rec {rn:+.0%}")
                if not any(n >= rn + 0.05 - 1e-9 for n in nets):
                    e.append(f"{tag}: needs a scenario at least 5 pts ABOVE Recommended "
                             f"(min spread §8); highest {max(nets):+.0%} vs rec {rn:+.0%}")
        for c in p.get("benefit_changes", []):
            if set(c) != {"item", "current", "renewal"}:
                e.append(f"{tag}: benefit_changes entry needs item/current/renewal, got {sorted(c)}")
    return e


def advisories(cfg):
    """Non-fatal notes — printed on render but never block it (addendum §7, §5)."""
    w = []
    for p in cfg.get("plans", []):
        cov = p.get("coverage")
        bump = p.get("assumptions", {}).get("admin_bump")
        step = ADMIN_STEP.get(cov)
        if step is not None and bump is not None and abs(bump - step) > 1e-9:
            w.append(f"{p.get('name')}: admin_bump {bump} deviates from the standard "
                     f"{cov} step ${step:.2f} — confirm this is intentional (broker comp?).")
        # Over-funded line priced to an increase, or a short line priced to a deep cut:
        adeq = p.get("assumptions", {}).get("adequacy_pct")
        lr = p.get("financials", {}).get("loss_ratio")
        if adeq is not None and lr is not None:
            if lr < 0.85 and adeq > 0.05:
                w.append(f"{p.get('name')}: loss ratio {lr:.0%} looks over-funded but "
                         f"adequacy_pct is +{adeq:.0%} — confirm the three-year/seasonality read.")
    # Cross-plan surplus supplement (§13): if one plan is sitting on >1 month of its own
    # claims funding while ANOTHER is being asked for an increase, the supplement should at
    # least be considered. Never silently leave idle money on the table.
    if not cfg.get("surplus_supplement"):
        rich = supplement_trigger(cfg)
        if rich:
            raising = [p["name"] for p in cfg.get("plans", [])
                       if any(s.get("recommended") and s.get("net_claims_pct", 0) > 0
                              for s in p.get("scenarios", []))]
            for p, mo in rich:
                targets = [n for n in raising if n != p["name"]]
                if targets:
                    w.append(f"{p['name']}: holds {mo:.1f} months of claims funding in surplus "
                             f"while {', '.join(targets)} is priced to an increase — consider a "
                             f"`surplus_supplement` block (§13).")
    return w


def load_config(path):
    """Import a config module by file path and return its CONFIG dict."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("group_config", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not hasattr(mod, "CONFIG"):
        raise SystemExit(f"{path}: no CONFIG dict found")
    return mod.CONFIG


def render(cfg, out_path):
    problems = validate(cfg)
    if problems:
        raise SystemExit("Config rejected:\n  " + "\n  ".join(problems))
    for note in advisories(cfg):
        print("  advisory:", note)
    HTML(string=build_html(cfg)).write_pdf(out_path)
    return cfg["total_pages"]


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        raise SystemExit("usage: python3 generate_renewal.py <config.py> [output.pdf]\n"
                         "       the generator holds no group data — pass a config file")
    cfg = load_config(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else \
        f"{cfg['group_name'].replace(' ', '_')}_{cfg['group_id']}_Renewal_Proposal.pdf"
    print("wrote", out, "pages:", render(cfg, out))
