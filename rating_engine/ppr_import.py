"""
PPR Import Parser — STUB FILE
==============================
Replace this file with your production implementation.
The stub below implements basic CSV/Excel parsing so the system works
end-to-end before the real parser is dropped in.

Expected interface (must be preserved in the replacement):
    process_file(file_bytes: bytes, file_ext: str, context: dict) -> dict

context keys:
    "clients"       list of {id, client_code, client_name}
    "plans"         list of {id, client_id, plan_name, effective_date, plan_year}
    "current_facts" list of current plan_performance_facts rows as dicts

Return value keys:
    "accepted"   list of rows ready to insert (or supersede+insert for restatements)
    "unchanged"  list of rows whose figures match what is already stored
    "held"       list of rows that failed validation
                 Each held row: {client_code, plan_name, report_month, report_year,
                                 raw_data, hold_reasons}

Accepted/unchanged row shape:
    {client_id, plan_id, report_month, report_year, version,
     ee_count, ee_spouse_count, ee_child_count, family_count,
     submitted_charges, paid_claims, claim_count,
     reason_code, reason_note, release_month, release_year,
     received_date, is_restatement, prior_paid_claims, prior_submitted_charges}
"""

import io
import csv
import logging
from datetime import date

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Expected CSV/Excel column names (case-insensitive, whitespace-stripped)
# ---------------------------------------------------------------------------
COL_MAP = {
    "client_code":        "client_code",
    "plan_name":          "plan_name",
    "report_month":       "report_month",
    "report_year":        "report_year",
    "ee_count":           "ee_count",
    "ee_spouse_count":    "ee_spouse_count",
    "ee_child_count":     "ee_child_count",
    "family_count":       "family_count",
    "submitted_charges":  "submitted_charges",
    "paid_claims":        "paid_claims",
    "claim_count":        "claim_count",
    "reason_code":        "reason_code",
    "reason_note":        "reason_note",
    "release_month":      "release_month",
    "release_year":       "release_year",
}

VALID_REASON_CODES = {
    "CLERICAL_CORRECTION",
    "CLAIMS_HELD_FUNDING",
    "CLAIMS_HELD_PROCESSING",
    "ENROLLMENT_RESTATEMENT",
    "OTHER",
}


def _parse_bytes(file_bytes: bytes, file_ext: str):
    """Return list of dicts from CSV or Excel bytes."""
    ext = file_ext.lower().lstrip(".")
    if ext == "csv":
        text = file_bytes.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        rows = []
        for row in reader:
            rows.append({k.strip().lower(): (v.strip() if v else "") for k, v in row.items()})
        return rows
    elif ext in ("xlsx", "xls"):
        try:
            import openpyxl
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
            ws = wb.active
            rows = list(ws.iter_rows(values_only=True))
            if not rows:
                return []
            headers = [str(h).strip().lower() if h is not None else "" for h in rows[0]]
            result = []
            for row in rows[1:]:
                result.append({headers[i]: (str(v).strip() if v is not None else "") for i, v in enumerate(row)})
            return result
        except ImportError:
            log.warning("openpyxl not installed; cannot parse Excel — pip install openpyxl")
            return []
    else:
        raise ValueError(f"Unsupported file extension: {ext}")


def _int_or_none(v):
    try:
        return int(float(v)) if v not in (None, "") else None
    except (ValueError, TypeError):
        return None


def _float_or_none(v):
    try:
        return round(float(v), 2) if v not in (None, "") else None
    except (ValueError, TypeError):
        return None


def _str_or_none(v):
    s = str(v).strip() if v else ""
    return s.upper() if s else None


def process_file(file_bytes: bytes, file_ext: str, context: dict) -> dict:
    """
    Parse a combined monthly PPR file and classify each row as
    accepted, unchanged, or held.
    """
    client_lookup = {c["client_code"].upper(): c for c in context.get("clients", [])}
    plan_lookup   = {}  # (client_id, plan_name_lower) -> plan
    for p in context.get("plans", []):
        key = (p["client_id"], p["plan_name"].lower())
        plan_lookup[key] = p

    # Build a quick lookup for current facts: (client_id, plan_id, month, year) -> row
    current_lookup = {}
    for f in context.get("current_facts", []):
        key = (f["client_id"], f["plan_id"], f["report_month"], f["report_year"])
        current_lookup[key] = f

    try:
        raw_rows = _parse_bytes(file_bytes, file_ext)
    except Exception as exc:
        log.error("Failed to parse file: %s", exc)
        return {"accepted": [], "unchanged": [], "held": [
            {"client_code": "FILE", "plan_name": "", "report_month": None, "report_year": None,
             "raw_data": {}, "hold_reasons": [f"File could not be parsed: {exc}"]}
        ]}

    accepted = []
    unchanged = []
    held = []

    for raw in raw_rows:
        # Normalise column names
        row = {COL_MAP.get(k, k): v for k, v in raw.items()}
        hold_reasons = []

        client_code  = (row.get("client_code") or "").upper().strip()
        plan_name    = (row.get("plan_name") or "").strip()
        report_month = _int_or_none(row.get("report_month"))
        report_year  = _int_or_none(row.get("report_year"))
        ee           = _int_or_none(row.get("ee_count"))
        ee_sp        = _int_or_none(row.get("ee_spouse_count"))
        ee_ch        = _int_or_none(row.get("ee_child_count"))
        fam          = _int_or_none(row.get("family_count"))
        submitted    = _float_or_none(row.get("submitted_charges"))
        paid         = _float_or_none(row.get("paid_claims"))
        claim_cnt    = _int_or_none(row.get("claim_count"))
        reason_code  = _str_or_none(row.get("reason_code"))
        reason_note  = (row.get("reason_note") or "").strip() or None
        rel_month    = _int_or_none(row.get("release_month"))
        rel_year     = _int_or_none(row.get("release_year"))

        # ── Validation ───────────────────────────────────────────────────────
        client = client_lookup.get(client_code)
        if not client:
            hold_reasons.append(f"Client code '{client_code}' not recognised")

        plan = None
        if client:
            plan = plan_lookup.get((client["id"], plan_name.lower()))
            if not plan:
                hold_reasons.append(f"Plan '{plan_name}' not found for {client_code}")

        if report_month is None or not (1 <= report_month <= 12):
            hold_reasons.append("Invalid or missing report_month (must be 1–12)")
        if report_year is None or report_year < 2000:
            hold_reasons.append("Invalid or missing report_year")

        if submitted is not None and paid is not None and paid > submitted:
            hold_reasons.append(
                f"paid_claims ({paid}) exceeds submitted_charges ({submitted})"
            )

        if reason_code and reason_code not in VALID_REASON_CODES:
            hold_reasons.append(
                f"Unknown reason_code '{reason_code}'. "
                f"Valid values: {', '.join(sorted(VALID_REASON_CODES))}"
            )
        if reason_code == "OTHER" and not reason_note:
            hold_reasons.append("reason_code OTHER requires a non-empty reason_note")

        # Check if month already on file (must be explicit restatement to update)
        is_restatement = False
        prior = None
        if client and plan and report_month and report_year:
            key = (client["id"], plan["id"], report_month, report_year)
            prior = current_lookup.get(key)
            if prior:
                # Figures changed without a reason code → hold as unremarked restatement
                figures_changed = (
                    _float_or_none(prior.get("paid_claims")) != paid
                    or _float_or_none(prior.get("submitted_charges")) != submitted
                )
                if figures_changed and not reason_code:
                    hold_reasons.append(
                        "Month already on file with different figures; "
                        "supply a reason_code to confirm restatement"
                    )
                elif figures_changed and reason_code:
                    is_restatement = True
                else:
                    # Figures are identical — unchanged
                    pass

        # Zero-paid with enrollment and no reason code
        total_enrollment = (ee or 0) + (ee_sp or 0) + (ee_ch or 0) + (fam or 0)
        if total_enrollment > 0 and (paid is None or paid == 0) and not reason_code:
            hold_reasons.append(
                "Zero paid claims with enrollment present and no reason code "
                "(possible funding issue — review before accepting)"
            )

        raw_data = dict(raw)

        if hold_reasons:
            held.append({
                "client_code": client_code,
                "plan_name":   plan_name,
                "report_month": report_month,
                "report_year":  report_year,
                "raw_data":     raw_data,
                "hold_reasons": hold_reasons,
            })
            continue

        row_data = {
            "client_id":        client["id"],
            "plan_id":          plan["id"],
            "report_month":     report_month,
            "report_year":      report_year,
            "version":          (prior["version"] + 1) if is_restatement and prior else 1,
            "ee_count":         ee,
            "ee_spouse_count":  ee_sp,
            "ee_child_count":   ee_ch,
            "family_count":     fam,
            "submitted_charges": submitted,
            "paid_claims":      paid,
            "claim_count":      claim_cnt,
            "reason_code":      reason_code,
            "reason_note":      reason_note,
            "release_month":    rel_month,
            "release_year":     rel_year,
            "received_date":    date.today().isoformat(),
            "is_restatement":   is_restatement,
            "prior_paid_claims":        _float_or_none(prior.get("paid_claims")) if prior else None,
            "prior_submitted_charges":  _float_or_none(prior.get("submitted_charges")) if prior else None,
        }

        # If prior exists and figures are identical, it's unchanged
        if prior and not is_restatement:
            unchanged.append(row_data)
        else:
            accepted.append(row_data)

    return {"accepted": accepted, "unchanged": unchanged, "held": held}
