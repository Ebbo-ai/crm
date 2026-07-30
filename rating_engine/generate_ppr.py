#!/usr/bin/env python3
"""
Simple Benefits - MONTHLY PLAN PERFORMANCE REPORT (PPR) generator.

Renders the cash-accurate "Thomas-style" PPR to HTML (for in-CRM display)
and PDF (for print/download). Holds no group data: all data arrives as a
single JSON payload so the CRM can call this as a service.

Cash model (locked 2026-07-30):
    Net Account Position = Funded - Paid Claims - Administrative Fee
    where Funded = Projected Claims            (funding_basis="claims")
                 = Projected Claims + Admin    (funding_basis="claims_admin")

Administrative Fee absorbs ALL overhead - administration, network access fees,
and broker/agent compensation. Broker comp is NEVER a separate line.

Two loss ratios, both on a Projected-claims denominator:
    LR claims       = Paid / Projected
    LR claims+admin = (Paid + Admin) / Projected

Plan-year aware: months are generated from plan_year_start, so May-April and
Oct-Sep groups render correctly. Not hardcoded to Jan-Dec.

Usage:
    python3 generate_ppr.py payload.json out.pdf
    python3 generate_ppr.py payload.json --html    # emit HTML only

Render: WeasyPrint v69.

Changelog (newest first):
  2026-07-30  v1.1  Reason codes, held/release month pairing with auto-generated
                    footnote, unexplained zero-paid alert, admin-fee footnote now
                    names program/marketing services.
  2026-07-30  v1.0  Initial. Cash-accurate net position, dual loss ratio,
                    outlier flagging, YTD reconciliation, plan-year awareness,
                    admin-fee footnote. Derived from the S455 Thomas template.
"""
__version__ = "1.1"
ENGINE = "generate_ppr.py"

import json, sys, datetime as _dt
from statistics import median

T = dict(ink="#16302b", green="#0c6b59", green_deep="#08382f", green_pale="#eaf2ef",
         gold="#b0802b", rule="#d7d2c4", muted="#5e6b66", paper="#ffffff",
         ok="#0c6b59", watch="#b0802b", alert="#9c2c2c",
         ok_bg="#e8f1ee", watch_bg="#fbf3e2", alert_bg="#f8ebeb")

MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

# Fixed reason codes for a month that has been held, restated, or corrected.
# Deliberately a closed list, not free text: it keeps footnote language consistent
# across every group and lets the collections flag fire automatically.
REASONS = {
    "clerical_correction":    "restated to correct a clerical error",
    "hold_client_funding":    "claims held pending receipt of client funding",
    "hold_admin_processing":  "claims held during administrator processing",
    "enrollment_restatement": "enrollment restated",
    "other":                  None,   # requires a typed note
}

# ---------------------------------------------------------------- helpers
def _money(v, blank="\u2013"):
    if v is None: return blank
    n = round(v)
    return f"(${abs(n):,.0f})" if n < 0 else f"${n:,.0f}"

def _money2(v, blank="\u2013"):
    if v is None: return blank
    return f"(${abs(v):,.2f})" if v < 0 else f"${v:,.2f}"

def _pct(v, blank="\u2013"):
    if v is None: return blank
    return f"({abs(v)*100:.1f}%)" if v < 0 else f"{v*100:.1f}%"

def _num(v, blank="\u2013"):
    if v is None: return blank
    return f"{round(v):,}"

def _f2(v, blank="\u2013"):
    return blank if v is None else f"{v:.2f}"

def _esc(s):
    return (str(s).replace("&","&amp;").replace("<","&lt;").replace(">","&gt;"))

# ---------------------------------------------------------------- core math
def tiers_of(plan):
    """Tier schema is per-plan, so 3-tier (EE/EE+1/EE+Fam) and 4-tier dental
    (EE/EE+Child/EE+Spouse/EE+Fam) both work. Each tier: key, label, claims, admin."""
    if plan.get("tiers"):
        return plan["tiers"]
    rc, ra = plan["rates"]["claims"], plan["rates"]["admin"]          # legacy 3-tier
    return [dict(key="ee",  label="EE",      claims=rc["ee"],  admin=ra["ee"]),
            dict(key="ee1", label="EE+1",    claims=rc["ee1"], admin=ra["ee1"]),
            dict(key="fam", label="EE+Fam",  claims=rc["fam"], admin=ra["fam"])]


def compute(plan):
    """Derive every figure for one plan from its raw monthly inputs.

    plan requires: plan_year_start "YYYY-MM", funding_basis, tiers[] (or legacy
    rates{}), and months[{month_index, <tier keys>, submitted, paid, claim_count}].
    Only months carrying enrollment are 'active'.
    """
    TI = tiers_of(plan)
    basis = plan.get("funding_basis", "claims")
    y0, m0 = (int(x) for x in plan["plan_year_start"].split("-"))

    rows, active = [], []
    by_index = {int(m["month_index"]): m for m in plan.get("months", [])}

    for i in range(12):
        mm = (m0 - 1 + i) % 12
        yy = y0 + (m0 - 1 + i) // 12
        r = dict(label=f"{MONTH_ABBR[mm]} {yy}", idx=i, enr={t["key"]: None for t in TI},
                 total=None, admin=None, projected=None,
                 submitted=None, paid=None, claim_count=None, outlay=None,
                 net=None, cum=None, lr=None, lr_admin=None, flag="",
                 status=None, note=None, paired_with=None)
        src = by_index.get(i)
        if src is not None:
            enr = {t["key"]: int(src.get(t["key"]) or 0) for t in TI}
            if sum(enr.values()) > 0:
                paid = float(src.get("paid") or 0)
                sub  = float(src.get("submitted") or 0)
                cnt  = int(src.get("claim_count") or 0)
                admin = sum(enr[t["key"]]*t["admin"]  for t in TI)
                proj  = sum(enr[t["key"]]*t["claims"] for t in TI)
                funded = proj + (admin if basis == "claims_admin" else 0.0)
                st = src.get("status") or {}
                r.update(status=st.get("code"), note=st.get("note"),
                         paired_with=st.get("paired_with"),
                         enr=enr, total=sum(enr.values()),
                         admin=admin, projected=proj, submitted=sub, paid=paid,
                         claim_count=cnt, outlay=paid+admin, net=funded-(paid+admin),
                         funded=funded,
                         lr=(paid/proj if proj else None),
                         lr_admin=((paid+admin)/proj if proj else None))
                active.append(r)
        rows.append(r)

    # running cumulative net position over active months only
    run = 0.0
    for r in rows:
        if r["net"] is not None:
            run += r["net"]; r["cum"] = run

    # outlier flags: over budget, or claim count >1.5x the active-month average
    counts = [r["claim_count"] for r in active if r["claim_count"]]
    avg_cnt = (sum(counts)/len(counts)) if counts else None
    for r in active:
        spike = avg_cnt is not None and r["claim_count"] > 1.5*avg_cnt
        if not r["claim_count"] and not r["paid"]:
            # Enrollment present so funding was billed, yet nothing was paid.
            # Explained = a reporting artifact. Unexplained = possibly a client
            # who has not funded the account, which is a collections matter.
            r["flag"] = "Held" if r["status"] else "Unexplained $0"
        elif r["status"] and r["status"] != "other":
            r["flag"] = "Restated"
        elif (r["lr"] is not None and r["lr"] > 1) or spike:
            r["flag"] = "Review"
        elif r["lr"] is not None and r["lr"] > 0.85:
            r["flag"] = "Watch"
        else:
            r["flag"] = "On track"

    n = len(active)
    S = lambda k: sum(r[k] for r in active) if n else 0.0
    t = dict(
        n_active=n,
        enr={tt["key"]: (sum(r["enr"][tt["key"]] for r in active)/n if n else None) for tt in TI},
        total=(sum(r["total"] for r in active)/n if n else None),
        admin=S("admin"), projected=S("projected"), submitted=S("submitted"),
        paid=S("paid"), claim_count=S("claim_count"), outlay=S("outlay"),
        net=S("net"), funded=S("funded"),
    )
    t["lr"]       = (t["paid"]/t["projected"]) if t["projected"] else None
    t["lr_admin"] = ((t["paid"]+t["admin"])/t["projected"]) if t["projected"] else None
    t["lr_median"]= median([r["lr"] for r in active if r["lr"] is not None]) if n else None
    t["lr_gap"]   = (t["lr"]-t["lr_median"]) if (t["lr"] is not None and t["lr_median"] is not None) else None
    t["avg_sub"]  = (t["submitted"]/t["claim_count"]) if t["claim_count"] else None
    t["avg_paid"] = (t["paid"]/t["claim_count"]) if t["claim_count"] else None
    t["reimb_pct"]= (t["paid"]/t["submitted"]) if t["submitted"] else None
    t["cpe"]      = (t["claim_count"]/n*12/t["total"]) if (n and t["total"]) else None
    t["pepm"]     = (t["paid"]/t["total"]/n) if (n and t["total"]) else None
    t["admin_pepm"]=(t["admin"]/t["total"]/n) if (n and t["total"]) else None
    t["net_annual"]=(t["net"]/n*12) if n else None
    # data integrity
    issues = []
    for r in active:
        if r["submitted"] and r["paid"] > r["submitted"]:
            issues.append(f"{r['label']}: paid exceeds submitted")
        if r["projected"] and r["paid"] > 3*r["projected"]:
            issues.append(f"{r['label']}: paid is over 3x projected (possible catch-up batch)")
    t["issues"] = issues
    return rows, t


def combine(plans):
    """Sum computed rows across plans into a combined view.

    Rates differ per plan, so the summary sums each plan's DERIVED figures
    rather than re-deriving from a single rate table.
    """
    per = [compute(p) for p in plans]
    base = per[0][0]
    TI = tiers_of(plans[0])
    keys = [t["key"] for t in TI]
    rows = []
    for i in range(12):
        src = [pr[0][i] for pr in per]
        live = [r for r in src if r["total"]]
        r = dict(label=base[i]["label"], idx=i, enr={k: None for k in keys}, total=None,
                 admin=None, projected=None, submitted=None, paid=None, claim_count=None,
                 outlay=None, net=None, cum=None, lr=None, lr_admin=None, flag="", funded=None,
                 status=None, note=None, paired_with=None)
        if live:
            st = next((x for x in src if x.get("status")), None)
            if st:
                r.update(status=st["status"], note=st["note"], paired_with=st["paired_with"])
            g = lambda k: sum(x[k] for x in live)
            r.update(enr={k: sum(x["enr"].get(k) or 0 for x in live) for k in keys},
                     total=g("total"),
                     admin=g("admin"), projected=g("projected"), submitted=g("submitted"),
                     paid=g("paid"), claim_count=g("claim_count"), outlay=g("outlay"),
                     net=g("net"), funded=g("funded"))
            r["lr"] = r["paid"]/r["projected"] if r["projected"] else None
            r["lr_admin"] = (r["paid"]+r["admin"])/r["projected"] if r["projected"] else None
        rows.append(r)

    run = 0.0
    for r in rows:
        if r["net"] is not None:
            run += r["net"]; r["cum"] = run

    active = [r for r in rows if r["total"]]
    counts = [r["claim_count"] for r in active if r["claim_count"]]
    avg_cnt = (sum(counts)/len(counts)) if counts else None
    for r in active:
        spike = avg_cnt is not None and r["claim_count"] > 1.5*avg_cnt
        if not r["claim_count"] and not r["paid"]:
            r["flag"] = "Held" if r["status"] else "Unexplained $0"
        elif r["status"] and r["status"] != "other":
            r["flag"] = "Restated"
        else:
            r["flag"] = "Review" if ((r["lr"] is not None and r["lr"] > 1) or spike) else \
                        ("Watch" if (r["lr"] is not None and r["lr"] > 0.85) else "On track")

    n = len(active)
    S = lambda k: sum(r[k] for r in active) if n else 0.0
    t = dict(n_active=n,
             enr={k: (sum(r["enr"][k] for r in active)/n if n else None) for k in keys},
             total=(sum(r["total"] for r in active)/n if n else None),
             admin=S("admin"), projected=S("projected"), submitted=S("submitted"),
             paid=S("paid"), claim_count=S("claim_count"), outlay=S("outlay"),
             net=S("net"), funded=S("funded"))
    t["lr"]        = (t["paid"]/t["projected"]) if t["projected"] else None
    t["lr_admin"]  = ((t["paid"]+t["admin"])/t["projected"]) if t["projected"] else None
    t["lr_median"] = median([r["lr"] for r in active if r["lr"] is not None]) if n else None
    t["lr_gap"]    = (t["lr"]-t["lr_median"]) if (t["lr"] is not None and t["lr_median"] is not None) else None
    t["avg_sub"]   = (t["submitted"]/t["claim_count"]) if t["claim_count"] else None
    t["avg_paid"]  = (t["paid"]/t["claim_count"]) if t["claim_count"] else None
    t["reimb_pct"] = (t["paid"]/t["submitted"]) if t["submitted"] else None
    t["cpe"]       = (t["claim_count"]/n*12/t["total"]) if (n and t["total"]) else None
    t["pepm"]      = (t["paid"]/t["total"]/n) if (n and t["total"]) else None
    t["admin_pepm"]= (t["admin"]/t["total"]/n) if (n and t["total"]) else None
    t["net_annual"]= (t["net"]/n*12) if n else None
    t["issues"]    = [i for pr in per for i in pr[1]["issues"]]
    return rows, t


def month_notes(rows, t):
    """Auto-generate the footnote lines a reader needs to avoid misreading a month.

    A held month and the month its claims were released in are only correct when
    read as a pair: the held month shows an inflated surplus, the release month an
    inflated deficit. Neither is true on its own.
    """
    notes, alerts = [], []
    for r in rows:
        if not r["total"]:
            continue
        if r["flag"] == "Unexplained $0":
            notes.append(f'{r["label"]}: funding was billed but no claims were paid. '
                         f'Cause not yet recorded — this month is under review and '
                         f'should not be read as favourable experience.')
            alerts.append(dict(month=r["label"], kind="unexplained_zero_paid",
                               detail="funding billed, no claims paid, no reason code on file"))
        elif r["status"]:
            phrase = REASONS.get(r["status"]) or (r["note"] or "restated")
            line = f'{r["label"]}: {phrase}'
            if r["paired_with"]:
                line += (f'; those claims were released in {r["paired_with"]}. '
                         f'{r["label"]} and {r["paired_with"]} should be read together — '
                         f'neither month is meaningful on its own.')
            else:
                line += "."
            if r["note"] and REASONS.get(r["status"]):
                line += f' {r["note"]}'
            notes.append(line)
    return notes, alerts


# ---------------------------------------------------------------- render
FOOT = ("Administrative Fee includes all plan overhead \u2014 third-party administration, "
        "program and marketing services, network access fees (if any), and broker/agent "
        "compensation (if any). Not all groups have a broker; when one is used, that "
        "compensation is included here and is not shown separately.")

NOTE = ("Reflects claims paid and mailed as of month end; it does not include claims "
        "incurred but not yet processed or paid. Net Account Position nets the "
        "Administrative Fee against funding to show the true cash balance \u2014 a claims "
        "surplus is not cash on hand. Ongoing adjustments (corrected or uncashed checks, "
        "claims held pending employer funding, and enrollment corrections) will affect "
        "actual outcomes.")

CSS = """
@page { size: letter landscape; margin: 0.45in 0.5in 0.55in 0.5in; }
* { box-sizing: border-box; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: %(ink)s;
       font-size: 7.9pt; margin: 0; }
.band { background: %(green_deep)s; color: #fff; padding: 6px 12px; border-radius: 3px 3px 0 0; }
.band h1 { margin: 0; font-size: 12.5pt; letter-spacing: .2px; }
.band .sub { font-size: 8.4pt; opacity: .88; margin-top: 2px; }
.meta { display: block; padding: 5px 12px;
        background: %(green_pale)s; border-bottom: 1px solid %(rule)s;
        font-size: 7.6pt; margin-bottom: 7px; }
.meta b { color: %(green_deep)s; } .meta span { margin-right: 20px; }
.chk { padding: 0 12px 6px; font-size: 7.5pt; color: %(muted)s; }
.chk .bad { color: %(alert)s; font-weight: 600; }
table { border-collapse: collapse; width: 100%%; }
.grid th, .grid td { border: 1px solid %(rule)s; padding: 0.6px 4px; text-align: right;
                     white-space: nowrap; }
.grid thead .grp th { background: %(green)s; color: #fff; text-align: center;
                      font-size: 7.2pt; letter-spacing: .4px; text-transform: uppercase;
                      border-color: %(green)s; padding: 3px 4px; }
.grid thead .lbl th { background: %(green_deep)s; color: #fff; text-align: center;
                      font-size: 7pt; font-weight: 600; border-color: %(green_deep)s;
                      line-height: 1.15; padding: 4px 3px; }
.grid td.mo { text-align: left; font-weight: 600; }
.grid td.c { text-align: center; }
.grid tbody tr:nth-child(even) td { background: #fafbfa; }
.grid tr.dim td { color: #b9c0bd; }
.grid tfoot td { background: %(green_pale)s; font-weight: 700;
                 border-top: 2px solid %(green_deep)s; border-bottom: 2px solid %(green_deep)s; }
.neg { color: %(alert)s; }
.lr-ok { background: %(ok_bg)s !important; color: %(ok)s; font-weight: 600; }
.lr-w  { background: %(watch_bg)s !important; color: %(watch)s; font-weight: 600; }
.lr-a  { background: %(alert_bg)s !important; color: %(alert)s; font-weight: 700; }
.fl-ok { color: %(muted)s; }
.fl-w  { background: %(watch_bg)s !important; color: %(watch)s; font-weight: 600; }
.fl-a  { background: %(alert_bg)s !important; color: %(alert)s; font-weight: 700; }
.spike { background: %(watch_bg)s !important; }
.lower { width: 100%%; margin-top: 6px; border-spacing: 8px 0; table-layout: fixed; }
.lower > tbody > tr > td { vertical-align: top; padding: 0; }
.card { border: 1px solid %(rule)s; border-radius: 3px; overflow: hidden; width: 100%%; }
.card h3 { margin: 0; background: %(green_deep)s; color: #fff; font-size: 7.4pt;
           padding: 3px 8px; letter-spacing: .3px; text-transform: uppercase; font-weight: 600; }
.card .bd { padding: 0; }
.kv { width: 100%%; font-size: 7.5pt; }
.kv td { padding: 0.8px 7px; border-bottom: 1px solid #eceae2; }
.kv td.k { color: %(ink)s; }
.kv td.v, .kv td.p, .kv td.d { text-align: right; white-space: nowrap; }
.kv td.p { color: %(muted)s; }
.kv tr.tot td { font-weight: 700; background: %(green_pale)s;
                border-top: 1.5px solid %(green_deep)s; border-bottom: none; }
.kv tr.hd td { font-size: 6.9pt; text-transform: uppercase; letter-spacing: .3px;
               color: %(muted)s; background: #f7f8f7; }
.read { padding: 4px 8px; font-size: 7.2pt; color: %(muted)s; border-top: 1px solid %(rule)s;
        background: #fcfbf7; }
.pd { padding: 4px 8px 5px; font-size: 7.5pt; }
.pd li { margin: 0 0 2px 14px; padding: 0; }
.pd ul { margin: 0; padding: 0; }
.foot { page-break-inside: avoid; margin-top: 5px; border-top: 1px solid %(rule)s; padding-top: 3px;
        font-size: 6.1pt; color: %(muted)s; line-height: 1.22; }
.foot .star { color: %(green_deep)s; font-weight: 600; }
.mnote { margin-top: 5px; border: 1px solid %(gold)s; background: #fcf8ef; border-radius: 3px;
         padding: 3px 8px; font-size: 6.9pt; color: %(ink)s; line-height: 1.3; }
.mnote b { color: %(green_deep)s; text-transform: uppercase; font-size: 6.7pt; letter-spacing: .3px; }
.mnote div { margin-top: 1px; }
.mnote .alert { color: %(alert)s; font-weight: 600; }
.stamp { margin-top: 3px; font-size: 6.4pt; color: #9aa39f; }
""" % T

def _lr_cls(v):
    if v is None: return ""
    return "lr-a" if v >= 1 else ("lr-w" if v >= 0.85 else "lr-ok")

def _fl_cls(f):
    return {"Review":"fl-a","Watch":"fl-w","On track":"fl-ok","Held":"fl-w",
            "Restated":"fl-w","Unexplained $0":"fl-a"}.get(f,"")

def render_html(p, pre=None):
    rows, t = pre if pre is not None else compute(p)
    basis = p.get("funding_basis","claims")
    basis_lbl = "Claims + Admin" if basis == "claims_admin" else "Claims only"

    # ---- header
    meta = [("Group ID", p.get("group_id","")), ("Plan", p.get("plan_name","")),
            ("Coverage", p.get("coverage","Dental")), ("Plan Year", p.get("plan_year_label","")),
            ("Funding basis", basis_lbl), ("Data as of", p.get("data_as_of",""))]
    meta_h = "".join(f"<span><b>{_esc(k)}:</b> {_esc(v)}</span>" for k,v in meta if v)

    if t["issues"]:
        chk = ('<div class="chk"><span class="bad">Data check \u2014 '
               + "; ".join(_esc(i) for i in t["issues"]) + "</span></div>")
    else:
        chk = '<div class="chk">Data check \u2014 all inputs internally consistent.</div>'

    # ---- grid
    TI = tiers_of(p)
    nt = len(TI)
    grp = [("",1),("Enrollment",nt+1),("Plan Costs &amp; Budget",2),
           ("Actual Activity",3),("Performance &amp; Cash Position",6)]
    grp_h = "".join(f'<th colspan="{c}">{n}</th>' for n,c in grp)
    lbls = ["Month"] + [t["label"] for t in TI] + ["Total","Admin<br/>Expense&nbsp;*",
            "Projected<br/>Claims","Submitted<br/>Charges","Paid<br/>Claims","# of<br/>Claims",
            "Total Outlay<br/>(Claims+Admin)","Net Account<br/>Position",
            "Cumulative<br/>Net Position","Loss Ratio<br/>Claims",
            "Loss Ratio<br/>Claims+Admin","Flag"]
    lbl_h = "".join(f"<th>{l}</th>" for l in lbls)

    body = []
    avg_cnt = None
    ac = [r["claim_count"] for r in rows if r["claim_count"]]
    if ac: avg_cnt = sum(ac)/len(ac)
    for r in rows:
        dim = "" if r["total"] else ' class="dim"'
        negn = " neg" if (r["net"] is not None and r["net"] < 0) else ""
        negc = " neg" if (r["cum"] is not None and r["cum"] < 0) else ""
        spike = ' class="c spike"' if (avg_cnt and r["claim_count"] and r["claim_count"] > 1.5*avg_cnt) else ' class="c"'
        enr_h = "".join(f'<td class="c">{_num(r["enr"].get(ti["key"]))}</td>' for ti in TI)
        body.append(
            f'<tr{dim}><td class="mo">{r["label"]}</td>'
            f'{enr_h}'
            f'<td class="c">{_num(r["total"])}</td>'
            f'<td>{_money(r["admin"])}</td><td>{_money(r["projected"])}</td>'
            f'<td>{_money(r["submitted"])}</td><td>{_money(r["paid"])}</td>'
            f'<td{spike}>{_num(r["claim_count"])}</td>'
            f'<td>{_money(r["outlay"])}</td>'
            f'<td class="{negn.strip()}">{_money(r["net"])}</td>'
            f'<td class="{negc.strip()}">{_money(r["cum"])}</td>'
            f'<td class="c {_lr_cls(r["lr"])}">{_pct(r["lr"])}</td>'
            f'<td class="c {_lr_cls(r["lr_admin"])}">{_pct(r["lr_admin"])}</td>'
            f'<td class="c {_fl_cls(r["flag"])}">{r["flag"] or "&nbsp;"}</td></tr>')

    tenr_h = "".join(f'<td class="c">{_num(t["enr"].get(ti["key"]))}</td>' for ti in TI)
    tf = (f'<tr><td class="mo">YTD / Avg</td>'
          f'{tenr_h}'
          f'<td class="c">{_num(t["total"])}</td>'
          f'<td>{_money(t["admin"])}</td><td>{_money(t["projected"])}</td>'
          f'<td>{_money(t["submitted"])}</td><td>{_money(t["paid"])}</td>'
          f'<td class="c">{_num(t["claim_count"])}</td><td>{_money(t["outlay"])}</td>'
          f'<td class="{"neg" if t["net"]<0 else ""}">{_money(t["net"])}</td><td></td>'
          f'<td class="c {_lr_cls(t["lr"])}">{_pct(t["lr"])}</td>'
          f'<td class="c {_lr_cls(t["lr_admin"])}">{_pct(t["lr_admin"])}</td>'
          f'<td></td></tr>')

    # ---- YTD / prior-year card
    pr = p.get("prior_year", {}) or {}
    def kv(label, cur, prior, fmt):
        d = (cur - prior) if (cur is not None and prior is not None) else None
        return (f'<tr><td class="k">{label}</td><td class="v">{fmt(cur)}</td>'
                f'<td class="p">{fmt(prior) if prior is not None else "&mdash;"}</td>'
                f'<td class="d{" neg" if (d is not None and d<0) else ""}">'
                f'{fmt(d) if d is not None else "&mdash;"}</td></tr>')
    ytd = [
        '<tr class="hd"><td>Metric</td><td class="v">Current YTD</td>'
        '<td class="p">Prior Year</td><td class="d">Change</td></tr>',
        kv("Loss Ratio &mdash; Claims only", t["lr"], pr.get("lr"), _pct),
        kv("Loss Ratio &mdash; Claims + Admin", t["lr_admin"], pr.get("lr_admin"), _pct),
        kv("Avg Submitted Charge / claim", t["avg_sub"], pr.get("avg_sub"), _money2),
        kv("Avg Reimbursement / claim", t["avg_paid"], pr.get("avg_paid"), _money2),
        kv("Reimbursement % of Submitted", t["reimb_pct"], pr.get("reimb_pct"), _pct),
        kv("Claims per Employee (annualized)", t["cpe"], pr.get("cpe"), _f2),
        kv("Paid Claims PEPM", t["pepm"], pr.get("pepm"), _money2),
        kv("Administrative Fee PEPM *", t["admin_pepm"], pr.get("admin_pepm"), _money2),
        f'<tr class="tot"><td class="k">Net Account Position (cash)</td>'
        f'<td class="v{" neg" if t["net"]<0 else ""}">{_money(t["net"])}</td>'
        f'<td class="p">&mdash;</td><td class="d">&mdash;</td></tr>',
        kv("Projected Year-End Net Position", t["net_annual"], pr.get("net_position"), _money),
    ]

    # ---- reconciliation
    rec = [f'<tr><td class="k">Funded into account ({basis_lbl.lower()})</td>'
           f'<td class="v">{_money(t["funded"])}</td></tr>',
           f'<tr><td class="k">Less: Paid Claims</td><td class="v neg">{_money(-t["paid"])}</td></tr>',
           f'<tr><td class="k">Less: Administrative Fee *</td><td class="v neg">{_money(-t["admin"])}</td></tr>',
           f'<tr class="tot"><td class="k">Net Account Position (cash)</td>'
           f'<td class="v{" neg" if t["net"]<0 else ""}">{_money(t["net"])}</td></tr>']

    gap = ""
    if t["lr_gap"] is not None and abs(t["lr_gap"]) >= 0.05:
        gap = (f'Aggregate claims loss ratio {_pct(t["lr"])} vs median month '
               f'{_pct(t["lr_median"])} &mdash; a gap of {_pct(abs(t["lr_gap"]))}. '
               f'One or more outlier months are pulling the yearly average; see months '
               f'flagged &ldquo;Review&rdquo;.')
    else:
        gap = (f'Aggregate claims loss ratio {_pct(t["lr"])} tracks the median month '
               f'{_pct(t["lr_median"])} &mdash; no single month is distorting the year.')

    design = p.get("plan_design") or []
    design_h = ("".join(f"<li>{_esc(d)}</li>" for d in design)) if design else ""
    design_card = (f'<div class="card" style="flex:1.05">'
                   f'<h3>Plan Design</h3><div class="pd"><ul>{design_h}</ul></div>'
                   f'<div class="read">{gap}</div></div>') if design_h else \
                  f'<div class="card" style="flex:1.05"><h3>Loss-ratio read</h3><div class="read">{gap}</div></div>'

    notes, alerts = month_notes(rows, t)
    if notes:
        items = "".join(
            f'<div class="{"alert" if "under review" in n else ""}">&bull; {n}</div>'
            for n in notes)
        notes_h = f'<div class="mnote"><b>How to read certain months</b>{items}</div>'
    else:
        notes_h = ""

    _t = _dt.date.today()
    stamp = (f'{ENGINE} v{__version__} &middot; rendered {MONTH_ABBR[_t.month-1]} {_t.day}, {_t.year}'
             f' &middot; data as of {_esc(p.get("data_as_of",""))}'
             f' &middot; {t["n_active"]} active month(s)')

    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>
<div class="band"><h1>{_esc(p.get("client_name",""))}</h1>
<div class="sub">Monthly Plan Performance &mdash; Projected vs. Actual</div></div>
<div class="meta">{meta_h}</div>
{chk}
<table class="grid"><thead><tr class="grp">{grp_h}</tr><tr class="lbl">{lbl_h}</tr></thead>
<tbody>{"".join(body)}</tbody><tfoot>{tf}</tfoot></table>
<table class="lower"><tbody><tr>
  <td style="width:40%"><div class="card"><h3>Year-to-Date Performance &amp; Prior-Year Comparison</h3>
    <table class="kv">{"".join(ytd)}</table></div></td>
  <td style="width:28%"><div class="card"><h3>Account Reconciliation &mdash; YTD</h3>
    <table class="kv">{"".join(rec)}</table>
    <div class="read">A claims surplus is not cash on hand. This walks funding down to
    the actual account balance after the Administrative Fee.</div></div></td>
  <td style="width:32%">{design_card}</td>
</tr></tbody></table>
{notes_h}
<div class="foot"><span class="star">*</span> {FOOT}<br/>
<b>Important Note:</b> {NOTE}
<div class="stamp">{stamp}</div></div>
</body></html>"""

def collect_alerts(plans):
    """Client-record alerts CRM should raise, independent of the rendered report."""
    out = []
    for p in plans:
        rows, t = compute(p)
        _, al = month_notes(rows, t)
        for a in al:
            a.update(group_id=p.get("group_id"), plan_id=p.get("plan_id"),
                     plan_name=p.get("plan_name"))
            out.append(a)
    return out


def render_report(plans, out_path=None, html_only=False):
    """Render a full PPR: combined Summary page (if >1 plan) + one page per plan."""
    if isinstance(plans, dict): plans = [plans]
    pages = []
    if len(plans) > 1:
        head = dict(plans[0]); head["plan_name"] = "All Plans \u2014 Combined"
        head["plan_id"] = head.get("group_id","")
        head["plan_design"] = ["Combined view of all plans in force",
                              "See the following pages for each plan's design and detail"]
        head["prior_year"] = plans[0].get("program_prior_year", {}) or {}
        pages.append(render_html(head, pre=combine(plans)))
    for p in plans:
        pages.append(render_html(p))
    if html_only:
        return pages
    from weasyprint import HTML
    docs = [HTML(string=h).render() for h in pages]
    all_pages = [pg for d in docs for pg in d.pages]
    docs[0].copy(all_pages).write_pdf(out_path)
    return out_path

def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    payload = json.load(open(sys.argv[1]))
    plans = payload if isinstance(payload, list) else [payload]
    base = f'{plans[0].get("group_id","ppr")}_PPR'
    if "--html" in sys.argv:
        for i, h in enumerate(render_report(plans, html_only=True)):
            fn = f"{base}_{i}.html"; open(fn,"w").write(h); print("wrote", fn)
    else:
        out = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else base+".pdf"
        render_report(plans, out); print("wrote", out)

if __name__ == "__main__":
    main()
