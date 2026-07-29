#!/usr/bin/env python3
"""Renewal config — Thomas County Schools (S455, Dental), from s455thomasppr2026.xlsx.

Two-plan dental group. Premium (design unchanged) and Standard (IMPROVED this renewal:
basic/major coinsurance 40%->50%, annual maximum $875->$1,000, funded from the plan's
own over-collection rather than a rate cut).

Method (Renewal Addendum §4-§8):
  * Anchor each plan to its own paid PEPM (2026 Jan-Jun + 2025), trended 3%,
    credibility-tempered. January paid was $0 on BOTH plans — claims were deferred
    during the 90 Degree administrator move (Duluth GA -> Bossier City LA) and released
    in the March payment, so the six-month total is a full six months of incurred claims
    (paid_months=5 only sets the monthly-claims denominator for the reserve line).
  * Premium: 2025 ran a ~$24,700 deficit (heavier severity); 2026 tracks at budget.
    adequacy +2.95%.  Options 0 / +5 / +10 (>=5% apart, addendum §8).
  * Standard: over-funded (82% LR). Buy-up (50% coins / $1,000 max) raises projected
    claims ~1.10x (ADA engine); richer-plan cost still ~8.5% under current rate, so the
    rate can be held flat while benefits improve. adequacy -8.51%.
    Options -5 / 0 (flat, improved) / +5.
  * Program dental account treated as pooled (net owned ~ +$94k = +$116.6k Standard,
    -$22.7k Premium).  Admin $6.00 -> $6.35 (standard $0.40 step, discounted for size).

Render:  python3 generate_renewal.py config_thomas_s455.py
"""
import datetime as _dt

TIERS = ["EE", "E+1", "EF"]
LABELS = {"EE": "Employee only", "E+1": "Employee + one", "EF": "Employee + family"}
HEADS = {"EE": "Employee<br>Only", "E+1": "Employee +<br>One", "EF": "Employee +<br>Family"}

_BASIS = (
    "January paid claims were nil — deferred during the mid-year administrator move from the "
    "Duluth, GA office to Bossier City, LA and released in the March payment — so the six-month "
    "total captures a full six months of incurred claims and is read as the forward signal.")

CONFIG = dict(
    group_name="Thomas County Schools", group_id="S455",
    program_coverage="Dental",
    prepared_date=_dt.date(2026, 7, 7).strftime("%B %-d, %Y"),
    renewal_effective="January 1, 2027",
    plan_year="January 1 – December 31, 2026",
    prepared_for="The Plan Sponsor & Broker of Record",

    disclosure_6=("Orthodontia is included on the Premium plan only, for adults and dependent "
                  "children; the Standard plan does not cover orthodontia."),

    program_notes=[
        dict(title="Standard is over-funded — so we are improving it, not cutting its rate.",
             body=("It paid well below what it collected in both of the last two years — an 82% "
                   "claims loss ratio this year and a large 2025 surplus. Rather than hand that "
                   "back as a rate reduction, we <b>enrich the plan</b> — basic/major coinsurance "
                   "to 50% (from 40%) and the annual maximum to $1,000 (from $875) — and hold the "
                   "claims rate flat. Even improved, the plan stays adequate and keeps a cushion.")),
        dict(title="Premium ran short in 2025 but is on budget in 2026.", accent="gold",
             body=("A heavier-severity 2025 left a deficit of about $24,700. In 2026 the plan "
                   "tracks right at its funded budget — the March spike was deferred January "
                   "claims from the 90 Degree office move (Duluth to Bossier City), a matter of "
                   "timing, not added utilization. We recommend stepping the rate toward adequacy "
                   "to begin retiring that deficit.")),
    ],
    program_cost_note=("Proposed reflects each plan's Recommended option and a $0.35 "
                       "administrative-fee adjustment — the standard step, discounted for group "
                       "size. Combined funding rises modestly: Standard's value is directed into "
                       "richer benefits rather than a rate cut, and Premium steps toward adequacy "
                       "after 2025's deficit."),
    owned_funds_note=("Across the program the district owns a net surplus of about <b>$94,000</b> — "
                      "roughly a <b>$116,600</b> positive position in Standard against a "
                      "<b>$22,700</b> shortfall in Premium. Under the self-funded model this money "
                      "is yours. Our advice is to price each plan to its own cost — improving "
                      "Standard's benefits rather than cutting its rate, and stepping Premium "
                      "toward adequacy — and then deploy the Standard surplus <i>separately</i>, "
                      "ideally as a contribution holiday. Suppressing a rate below its real cost "
                      "only recreates the shortfall next year."),

    plans=[
        # ===================== PREMIUM (design unchanged) =====================
        dict(
            name="Premium", plan_id="S455 Premium", coverage="Dental",
            tiers=TIERS, tier_labels=LABELS, tier_heads=HEADS,
            design={"Preventive &amp; diagnostic": "100%", "Deductible": "$50 (not P&amp;D)",
                    "Basic / major": "60% of balance", "Annual maximum": "$1,500",
                    "Orthodontia": "Adults &amp; children", "Assignment of benefits": "Yes"},
            enrollment={"EE": 139.0, "E+1": 84.667, "EF": 127.5},
            current_rates={"claims": {"EE": 49.90, "E+1": 93.10, "EF": 142.75}, "admin": 6.00},
            financials=dict(months=6, paid_months=5, claims_collected=198115.15,
                            claims_paid=196056.19, admin_collected=12642.00, loss_ratio=0.990,
                            current_surplus=2058.96, prior_surplus=-24747.02,
                            cum_surplus=-22688.06),
            assumptions=dict(trend=0.03, adequacy_pct=0.0295, admin_bump=0.35, broker_comp=0.00),
            adequacy_note=(
                "Premium finished 2025 with a deficit of about <b>$24,700</b> on a heavier-severity "
                "year. In 2026 it is tracking right at its funded budget — the large March payment "
                "was deferred January claims released after the administrator move, a timing effect "
                "rather than added utilization. Trended 3% to 2027, the plan's own run-rate lands "
                "right about on today's rate, so we step the claims rate up to cover trend and "
                "begin retiring the accumulated shortfall."),
            benefit_note=(
                "The $1,500 annual maximum, the 60% coinsurance and the adult &amp; child "
                "orthodontia are unchanged; this adjustment is one of price, not design. No benefit "
                "change is proposed for the Premium plan."),
            basis_note=_BASIS,
            options_axis="how large a step to take after 2025's deficit",
            which_note=(
                "The <b>Recommended</b> option steps the rate up enough to cover trend and start "
                "working down the accumulated deficit. <b>Value</b> holds the rate flat — the "
                "lowest cost now, but it leans on the district's owned funds and a mid-year funding "
                "call is more likely while the shortfall stands. <b>Protective</b> takes a larger "
                "step that rebuilds margin against a heavy-severity year and retires the deficit "
                "faster."),
            benefit_changes=[],
            scenarios=[
                dict(key="value", name="Value (no increase)", tag="Lower cost", net_claims_pct=0.00,
                     blurb="Holds the claims rate flat. Lowest cost now, but leans on the district's "
                           "owned funds and is the most likely to need a mid-year funding call."),
                dict(key="recommended", name="Recommended (+5%)", net_claims_pct=0.05,
                     recommended=True,
                     blurb="Steps the rate up to cover trend and begin retiring the accumulated "
                           "deficit. Balanced and honest to the plan's own cost."),
                dict(key="protective", name="Protective (+10%)", tag="Most cushion",
                     net_claims_pct=0.10,
                     blurb="A larger step that rebuilds margin against a heavy-severity year and "
                           "works the accumulated shortfall down faster."),
            ],
        ),
        # ===================== STANDARD (design improved) =====================
        dict(
            name="Standard", plan_id="S455 Standard", coverage="Dental",
            tiers=TIERS, tier_labels=LABELS, tier_heads=HEADS,
            design={"Preventive &amp; diagnostic": "100%", "Deductible": "$50 (not P&amp;D)",
                    "Basic / major": "50% of balance", "Annual maximum": "$1,000",
                    "Orthodontia": "Not covered", "Assignment of benefits": "Yes"},
            enrollment={"EE": 278.5, "E+1": 60.667, "EF": 131.333},
            current_rates={"claims": {"EE": 30.65, "E+1": 56.90, "EF": 84.20}, "admin": 6.00},
            financials=dict(months=6, paid_months=5, claims_collected=138277.35,
                            claims_paid=114085.60, admin_collected=16938.00, loss_ratio=0.825,
                            current_surplus=24191.75, prior_surplus=92455.20,
                            cum_surplus=116646.95),
            assumptions=dict(trend=0.03, adequacy_pct=-0.0851, admin_bump=0.35, broker_comp=0.00),
            adequacy_note=(
                "Standard collected well above what it paid in both years — an <b>82%</b> loss "
                "ratio this year and a large 2025 surplus — and its paid experience is very stable "
                "(about $40 per employee per month). Trended 3% to 2027, the current design's own "
                "claims sit well under today's rate. Rather than cut the rate, we recommend "
                "<b>improving the plan</b> — basic/major coinsurance to 50% (from 40%) and the "
                "annual maximum to $1,000 (from $875). Even after the improvement the plan stays "
                "adequate at today's rate and continues to run a modest surplus."),
            benefit_note=(
                "This renewal the plan is <b>improved</b>: basic/major coinsurance rises from 40% "
                "to 50% and the annual maximum from $875 to $1,000, funded by the plan's own "
                "over-collection rather than a rate change. Preventive &amp; diagnostic remain "
                "covered at 100%."),
            basis_note=_BASIS,
            options_axis="how the plan's over-funding is split between richer benefits and rate",
            which_note=(
                "The <b>Recommended</b> option holds the rate flat and directs the plan's "
                "over-funding into richer benefits (50% coinsurance, a $1,000 maximum); even "
                "improved, the plan stays adequate and keeps building a small cushion. <b>Value</b> "
                "passes some of the remaining headroom back as a lower rate. <b>Protective</b> "
                "keeps a little more rate to build the cushion faster. The large accumulated "
                "surplus is best deployed separately — ideally as a contribution holiday."),
            benefit_changes=[
                dict(item="Basic &amp; major coinsurance", current="40% of balance",
                     renewal="50% of balance"),
                dict(item="Annual maximum", current="$875", renewal="$1,000"),
            ],
            scenarios=[
                dict(key="value", name="Value (net −5%)", tag="Lower cost", net_claims_pct=-0.05,
                     blurb="Improved benefits and a lower rate — passes part of the remaining "
                           "headroom back. The plan stays adequate on its own experience."),
                dict(key="recommended", name="Recommended (flat)", net_claims_pct=0.00,
                     recommended=True,
                     blurb="Improved benefits with the rate held flat — the value goes into the "
                           "plan, not a rate cut. Stays adequate and keeps building a modest surplus."),
                dict(key="protective", name="Protective (net +5%)", tag="Most cushion",
                     net_claims_pct=0.05,
                     blurb="Improved benefits with a small rate step that builds the plan's owned "
                           "surplus faster against a heavy claims year."),
            ],
        ),
    ],
)
