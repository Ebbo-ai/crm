"""
PPR Coverage Types — shared canonical list and normaliser
=========================================================
Both ppr_import.py and ppr_report.py import from this module so the
mapping lives in exactly one place.

Coverage describes how a plan is *funded and reported*, not its clinical
scope.  A group with one dental plan and a separate vision plan on separate
rates has TWO plans (each DENTAL_ONLY / VISION_ONLY).  A group where one
rate covers both has ONE plan marked DENTAL_VISION.  Never split a combined
plan into separate dental and vision rows.

Canonical values
----------------
DENTAL_ONLY            — dental benefits only
VISION_ONLY            — vision benefits only
DENTAL_VISION          — dental and vision combined on a single rate
DENTAL_VISION_HEARING  — dental, vision, and hearing combined (one group)
"""

# ---------------------------------------------------------------------------
# The four valid coverage types
# ---------------------------------------------------------------------------
COVERAGE_TYPES = [
    "DENTAL_ONLY",
    "VISION_ONLY",
    "DENTAL_VISION",
    "DENTAL_VISION_HEARING",
]

# ---------------------------------------------------------------------------
# Alias table: maps lowercased/stripped administrator variations → canonical
# ---------------------------------------------------------------------------
_ALIASES: dict[str, str] = {}

_ALIAS_MAP: list[tuple[str, list[str]]] = [
    ("DENTAL_ONLY", [
        "dental_only", "dental only", "dental-only",
        "dental", "dent", "d",
    ]),
    ("VISION_ONLY", [
        "vision_only", "vision only", "vision-only",
        "vision", "vis", "v",
    ]),
    ("DENTAL_VISION", [
        "dental_vision", "dental/vision", "dental & vision",
        "dental and vision", "dental vision", "vision/dental",
        "vision and dental", "d/v", "dv",
        "dental + vision", "vision + dental",
        "d + v", "dental-vision",
    ]),
    ("DENTAL_VISION_HEARING", [
        "dental_vision_hearing", "dental/vision/hearing",
        "dental vision hearing", "dental & vision & hearing",
        "dental and vision and hearing", "dental, vision, hearing",
        "dental, vision and hearing", "dental vision and hearing",
        "d/v/h", "dvh", "dental + vision + hearing",
        "dental-vision-hearing",
    ]),
]

for _canonical, _variants in _ALIAS_MAP:
    # canonical value itself is always accepted
    _ALIASES[_canonical.lower()] = _canonical
    for _v in _variants:
        _ALIASES[_v] = _canonical


def normalize_coverage_type(raw: str | None) -> str | None:
    """
    Map a raw administrator-supplied string to a canonical coverage type.
    Returns the canonical string (e.g. ``"DENTAL_VISION"``) on success,
    or ``None`` if the value is not recognised.

    Examples
    --------
    >>> normalize_coverage_type("dental/vision")
    'DENTAL_VISION'
    >>> normalize_coverage_type("DVH")
    'DENTAL_VISION_HEARING'
    >>> normalize_coverage_type("bicuspid")
    None
    """
    if not raw:
        return None
    key = str(raw).strip().lower()
    # collapse multiple spaces
    while "  " in key:
        key = key.replace("  ", " ")
    return _ALIASES.get(key)
