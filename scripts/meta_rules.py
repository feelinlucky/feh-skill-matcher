"""Meta-tier policy: which skills the recommender is allowed to surface.

The tool is meant to answer "what should I put in this empty slot today", so the
candidate pool is restricted to **top-tier, non-exclusive** skills:

* ``exclusive`` (prf) skills are dropped — they cannot be inherited, so they are
  never a complementary option for a different hero.
* only the terminal node of a progression line survives. ``feh-data`` ships the
  full upgrade graph (``upgrade_ids`` / ``downgrade_ids``), so a skill with any
  child is a prerequisite (Fury 3 -> Fury 4, Swift Sparrow 2 -> Remote Sparrow)
  and is never recommended.
* a per-slot SP floor removes legacy lines that never got a direct successor
  (Aegis, Atk +3, Live for Honor, ...). The floors mirror FEH's SP economy
  rather than one global number, because each slot tops out differently: a
  Sacred Seal caps at 240 SP while a Special in the modern pool costs 500.

Everything else (hero default kits, the hero's own prf skills, manual slot
picking) still uses the complete dataset — see ``build_data.build``.
"""
from __future__ import annotations

import re

# Top SP band per slot category. Derived from the terminal, non-prf nodes of
# the upstream export; rebuild with `python3 scripts/build_data.py` and check
# the printed coverage when the data is refreshed.
SP_FLOORS: dict[str, int] = {
    "weapon": 300,
    "assist": 150,
    "special": 500,
    "passivea": 300,
    "passiveb": 300,
    "passivec": 300,
    "passivex": 0,      # Attuned / Emblem echoes carry no SP
    "sacredseal": 240,  # seals cap below the passive tiers
}

FLOOR_NOTES: dict[str, str] = {
    "weapon": "inheritable weapons top out at 300 SP",
    "assist": "support assists such as Reposition stay available",
    "special": "modern Specials cost 500 SP",
    "passivea": "tier-4 A skills",
    "passiveb": "tier-4 B skills (400 SP lines included)",
    "passivec": "tier-4 C skills",
    "passivex": "X-slot echoes carry no SP",
    "sacredseal": "max sacred-seal tier",
}

SLOT_LABELS = {
    "weapon": "Weapon",
    "assist": "Assist",
    "special": "Special",
    "passivea": "A",
    "passiveb": "B",
    "passivec": "C",
    "passivex": "X",
    "sacredseal": "Seal",
}

_VERSION_RE = re.compile(r"^\s*(\d+)(?:\.(\d+))?\s*$")


def version_score(text: str | None) -> int | None:
    """'10.10' -> 1010, '4.5' -> 405, '1.0' -> 100.

    Encoded so a plain integer comparison matches release order; a float would
    order 10.10 before 10.2.
    """
    if not text:
        return None
    match = _VERSION_RE.match(str(text))
    if not match:
        return None
    major = int(match.group(1))
    minor = int(match.group(2) or 0)
    return major * 100 + minor


def version_label(score: int | None) -> str:
    if score is None:
        return ""
    return f"{score // 100}.{score % 100:02d}".replace(".00", ".0")


def is_recommendable(category: str, sp: int | None, exclusive: bool,
                     is_sub_tier: bool) -> bool:
    if exclusive or is_sub_tier:
        return False
    return (sp or 0) >= SP_FLOORS.get(category, 0)


def policy(pruned: bool) -> dict:
    """Published as data/meta.json so the UI can explain and mirror the rules."""
    return {
        "spFloors": SP_FLOORS,
        "floorNotes": FLOOR_NOTES,
        "slotLabels": SLOT_LABELS,
        "rules": {
            "exclusive": "unit-exclusive (prf) skills are never recommended",
            "maxTier": "only the terminal node of an upgrade line is recommended",
            "spFloor": "per-slot SP floor removes legacy lines with no successor",
            "sort": ["synergy score", "SP desc", "version desc", "name asc"],
        },
        "pruned": pruned,
    }
