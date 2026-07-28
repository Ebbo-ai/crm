"""
Sample group configuration for end-to-end testing.
Passes validate() and advisories() clean.
Swap group_name / group_id / prepared_for / renewal_effective when testing real clients.
"""

import datetime as _dt

_today = _dt.date.today().strftime("%-m/%-d/%Y")

CONFIG = {
    # ── Program header ────────────────────────────────────────────────────
    "group_name":          "Westside School District",
    "group_id":            "S-999",
    "program_coverage":    "Dental",
    "prepared_date":       _today,
    "renewal_effective":   "January 1, 2027",
    "plan_year":           "January 1 – December 31, 2026",
    "prepared_for":        "Westside School District",

    # ── Dental programs must explicitly state orthodontia scope (§17 disc 6) ─
    "disclosure_6": (
        "Orthodontia is provided for dependent children only and is included on "
        "the Standard Plan as shown in this proposal."
    ),

    # ── Single plan → no overview page, no program_notes needed ─────────
    "plans": [
        {
            # ── Identity ─────────────────────────────────────────────────
            "name":     "Standard",
            "coverage": "Dental",

            # ── Tier schema ───────────────────────────────────────────────
            "tiers":       ["EE", "ES", "EC", "EF"],
            "tier_labels": {
                "EE": "Employee Only",
                "ES": "Employee + Spouse",
                "EC": "Employee + Child(ren)",
                "EF": "Employee + Family",
            },
            "tier_heads": {
                "EE": "EE",
                "ES": "EE+S",
                "EC": "EE+C",
                "EF": "EE+F",
            },

            # ── Plan design (shown on summary page) ───────────────────────
            "design": {
                "Annual Maximum":    "$1,000 per person",
                "Deductible":        "$50 individual / $150 family",
                "Preventive":        "100% — no deductible",
                "Basic Restorative": "80% after deductible",
                "Major Restorative": "50% after deductible",
                "Orthodontia":       "50%, $1,500 lifetime max — dependents only",
                "Freedom of Choice": "Any licensed dental provider",
            },

            # ── Average enrollment ────────────────────────────────────────
            "enrollment": {
                "EE": 42.0,
                "ES":  8.0,
                "EC": 11.0,
                "EF":  7.0,
            },

            # ── Current in-force rates ────────────────────────────────────
            #   claims = the claims-funding component of the monthly rate
            #   admin  = the flat administrative fee
            "current_rates": {
                "claims": {
                    "EE": 28.50,
                    "ES": 54.25,
                    "EC": 49.75,
                    "EF": 74.00,
                },
                "admin": 6.50,
            },

            # ── 12-month financials ───────────────────────────────────────
            "financials": {
                "months":            12,
                "paid_months":       12,   # same as months → no basis_note required
                # claims funding collected = Σ(enrollment × claims_rate × 12)
                #   = (42×28.50 + 8×54.25 + 11×49.75 + 7×74.00) × 12
                #   = (1197 + 434 + 547.25 + 518) × 12 = 2696.25 × 12 = 32,355
                "claims_collected":  32_355.00,
                "claims_paid":       28_150.00,
                "loss_ratio":        0.871,       # 28,150 / 32,355
                "current_surplus":    4_205.00,   # collected − paid this year
                "prior_surplus":      3_480.00,   # year-end result prior year
                "cum_surplus":        7_685.00,   # owned reserve going into renewal
            },

            # ── Actuarial assumptions ─────────────────────────────────────
            "assumptions": {
                "trend":        0.04,    # 4 % dental trend
                "adequacy_pct": 0.06,    # 6 % adequacy load → net ~+6 % on Recommended
                "admin_bump":   0.40,    # standard dental annual step (addendum §7)
                "broker_comp":  0.00,    # no separate broker comp
            },

            # ── Summary-page narrative ────────────────────────────────────
            "adequacy_note": (
                "The plan ran at an 87 % loss ratio this year, slightly above the "
                "long-run dental average. We project dental trend at 4 % and "
                "add a 6 % adequacy load to keep the plan adequately funded going "
                "into the renewal year."
            ),
            "benefit_note": (
                "The plan design carries the same annual maximum and cost-share "
                "structure as the current year. "
            ),
            "options_axis": "buy down the rate increase",
            "which_note": (
                "For most groups Recommended is the right call: it fully funds "
                "projected claims while holding roughly two months of claims in "
                "reserve. Value is available if cash flow is a priority this year; "
                "Protective makes sense if the group had a heavy claims spike and "
                "wants to rebuild its cushion quickly."
            ),

            # ── Benefit changes for the renewal ──────────────────────────
            "benefit_changes": [],   # no changes proposed

            # ── Three funding scenarios (spread ≥ 5 pp on each side) ─────
            "scenarios": [
                {
                    "key":            "value",
                    "name":           "Value (−10%)",
                    "tag":            "Use More Reserve",
                    "net_claims_pct": -0.10,       # 10 pp below Recommended
                    "blurb": (
                        "Draws down 10% of the rate increase using owned surplus. "
                        "Lowest monthly cost this year; reserve ends lighter."
                    ),
                    "recommended": False,
                },
                {
                    "key":            "recommended",
                    "name":           "Recommended",
                    "tag":            "",
                    "net_claims_pct":  0.06,       # +6 % adequacy load
                    "blurb": (
                        "Fully funds projected dental claims, holds two months of "
                        "claims in reserve, and is priced to be adequate for "
                        "a normal claims year."
                    ),
                    "recommended": True,
                },
                {
                    "key":            "protective",
                    "name":           "Protective (+10%)",
                    "tag":            "Build Reserve",
                    "net_claims_pct":  0.16,       # 10 pp above Recommended
                    "blurb": (
                        "Builds an additional 10% cushion on top of the adequacy "
                        "load. Best if the group anticipates heavier utilisation "
                        "or wants to enter next year with a stronger reserve."
                    ),
                    "recommended": False,
                },
            ],
        }
    ],
}
