#!/usr/bin/env python3
"""Build the compact runtime dataset used by the web app from `feh-data`.

Source (https://github.com/matxx/feh-data, cloned into./feh-data):

    feh-data/data/skills.json                skill list (category, sp, restrictions, ...)
    feh-data/data/skills-descriptions.json   skill wording
    feh-data/data/units.json                 heroes
    feh-data/data/skills_units.json          which hero learns / equips which skill

Output (committed so GitHub Pages works without the raw export):

    data/skills.json    skills + modifier tiers + named effects + synergy targets
    data/units.json     heroes + their default (base) skill set + prf skill ids
    data/effects.json   the named-effect catalog and synergy rules used by the UI

Skill schema
------------
    {
      "id", "name", "slot", "cat", "sp", "tier", "wt", "cd", "mt", "rng",
      "prf", "refine", "base", "res", "desc",
      "named_effects":   ["visible_buff_grant", "special_acceleration"],
      "flat_modifiers":  {"visible_atk": 6, "visible_spd": 6, "combat_atk": 3},
      "synergy_targets": ["visible_buff_scaling", "high_cooldown_special"],
      "check_stats":     ["Spd"],
      "clauses":         [["buff", "ally", "visible", "Atk/Spd+6 for 1 turn"]]
    }

`flat_modifiers` keys are ``[foe_]<tier>_<stat>`` where tier is one of
``visible`` (field buffs/debuffs), ``flat`` (always-on stat changes such as
Life and Death), ``phantom`` ("as if granted", comparison only) or ``combat``
(during combat only). Ally entries have no prefix, foe entries are ``foe_``
prefixed, and both use the sign as written in the wording.

Usage:
    git clone https://github.com/matxx/feh-data feh-data
    python3 scripts/build_data.py
    python3 scripts/build_data.py --source /path/to/feh-data/data
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from effects_catalog import (
    CHECK_STAT_PATTERNS,
    EFFECTS,
    SYNERGY_RULES,
    TARGET_RULES,
    catalog,
    name_effects,
)

SLOT_BY_CATEGORY = {
    "weapon": "Weapon",
    "assist": "Assist",
    "special": "Special",
    "passivea": "A",
    "passiveb": "B",
    "passivec": "C",
    "sacredseal": "Seal",
    "passivex": "X",
}
# Categories that belong to a hero rather than to a slot.
NON_SLOT_CATEGORIES = {"duo", "harmonized", "emblem"}

STATS = ("Atk", "Spd", "Def", "Res")
STAT_ALT = "|".join(STATS)

TIERS = ("visible", "flat", "phantom", "combat")

STAT_DELTA_RE = re.compile(
    rf"\b((?:{STAT_ALT})(?:\s*/\s*(?:{STAT_ALT}))*)\s*([+\-−])\s*(\d+)\b"
)
GLOSSARY_HEADER_RE = re.compile(r"^【[^】]{1,40}】$")

FOE_TARGET_RE = re.compile(
    r"\b(?:the |those |all |nearest |any )*foes?\b(?! ?\w*ally)|foe's\b|"
    r"\bon (?:the )?target\b|inflicts?[^.]{0,90}?\bfoes?\b",
    re.I,
)
ALLY_TARGET_RE = re.compile(
    r"to unit\b|on unit\b|unit and allies|to (?:the )?unit\b|unit's own\b|"
    r"grants?[^.]{0,40}\bto (?:the )?unit\b",
    re.I,
)
DURATION_RE = re.compile(
    r"for 1 turn|for 1 turn only|that turn only|through (?:their|its) next action|"
    r"through unit's next action|for the rest of the turn",
    re.I,
)
COMBAT_RE = re.compile(r"during combat|\bin combat\b|at the start of combat", re.I)

# Wording that signals a clause is a formula/constant rather than a plain number.
CONST_RE = re.compile(r"\bX\s*=|equal to|×\s*\d|\d\s*×|% of |calculates? each stat", re.I)
TRUE_DAMAGE_RE = re.compile(r"deals? \+\d+ damage|damage = \d+% of", re.I)
# Fragments such as "After combat" or "When Special triggers" left behind by
# sub-clause splitting carry no effect of their own.
FRAGMENT_RE = re.compile(
    r"^(?:after combat|when special triggers|during combat|at start of turn|"
    r"at start of combat|after canto|if unit is within \d+ space[s]? of an ally|"
    r"if unit initiates combat|while unit|if [^.a-z]{0,0}[^.]{0,60})$",
    re.I,
)
EFFECT_VERB_RE = re.compile(
    r"grant|inflict|deal|reduc|restor|neutrali[sz]|prevent|treat|cooldown|"
    r"accelerat|convert|disable|movement|another action",
    re.I,
)
HEAL_RE = re.compile(r"restores? (?:\d+% of .{0,20} )?(?:\d+ )?hp", re.I)


def load(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


# --------------------------------------------------------------------------- #
# text handling
# --------------------------------------------------------------------------- #

def norm_text(raw: str | None) -> str:
    if not raw:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", raw)
    text = re.sub(r"<[^>]+>", "", text)
    text = (text.replace("&amp;", "&").replace("&#39;", "'")
            .replace("&quot;", '"').replace("&nbsp;", " "))
    return text.strip()


def main_text(text: str) -> str:
    """Drop the trailing glossary paragraphs (【Bonus】, 【Penalty】, ...)."""
    kept: list[str] = []
    for line in text.split("\n"):
        if GLOSSARY_HEADER_RE.match(line.strip()):
            break
        kept.append(line)
    return "\n".join(kept)


# A clause break is only worth taking when a new verb starts the next clause,
# otherwise "unit's Special is ready" gets orphaned mid-sentence.
SUBCLAUSE_STARTS = (
    r"grants?", r"inflicts?", r"deals?", r"reduces?", r"restores?",
    r"neutrali[sz]es?", r"prevents?", r"treats?", r"accelerates?",
    r"unit (?=(?:deals|takes|attacks|cannot|can |gains|is |moves|suffers|and ))",
    r"foe (?=(?:deals|takes|cannot|can |is |suffers))",
    r"target (?=(?:cannot|can |is ))",
    r"allies (?=(?:and |within |deals))",
)
SUBCLAUSE_RE = re.compile(
    r"\s*(?:;\s*|,?\s+and\s+(?:also,?\s+)?|,\s*)"
    r"(?=(?:" + "|".join(SUBCLAUSE_STARTS) + r"))",
    re.I,
)
QUOTED_RE = re.compile(r'"[^"]*"|“[^”]*”')


def split_sentences(text: str) -> list[str]:
    """Split on sentence boundaries, ignoring dots inside parentheses/quotes."""
    out: list[str] = []
    buffer = ""
    depth = 0
    in_quote = False
    index = 0
    while index < len(text):
        char = text[index]
        buffer += char
        if char == '"':
            in_quote = not in_quote
        elif not in_quote:
            if char == "(":
                depth += 1
            elif char == ")":
                depth = max(0, depth - 1)
        closes_quote = (in_quote and index + 1 < len(text)
                        and text[index + 1] in '"\u201d')
        if char in ".!?" and depth == 0 and (not in_quote or closes_quote):
            cursor = index + 1
            while cursor < len(text) and text[cursor] in '"\u201d':
                buffer += text[cursor]
                cursor += 1
            if in_quote and closes_quote:
                in_quote = False
            if cursor >= len(text) or text[cursor].isspace():
                out.append(buffer.strip())
                buffer = ""
                index = cursor
                continue
        index += 1
    if buffer.strip():
        out.append(buffer.strip())
    return out


def split_subclauses(sentence_text: str) -> list[str]:
    """Break a sentence at ';' and at ', and <verb>' outside quotes/parens.

    "grants Atk/Spd+6 and grants Special cooldown charge +1 ... during combat"
    becomes two clauses so a field buff is not misread as an in-combat buff.
    """
    parts: list[str] = []
    buffer = ""
    depth = 0
    in_quote = False
    index = 0
    while index < len(sentence_text):
        char = sentence_text[index]
        if char == '"':
            in_quote = not in_quote
        elif not in_quote:
            if char == "(":
                depth += 1
            elif char == ")":
                depth = max(0, depth - 1)
        if not in_quote and depth == 0:
            match = SUBCLAUSE_RE.match(sentence_text, index)
            if match and match.end() > index and buffer.strip():
                parts.append(buffer.strip())
                buffer = ""
                index = match.end()
                continue
        buffer += char
        index += 1
    if buffer.strip():
        parts.append(buffer.strip())
    return parts


def split_clauses(text: str) -> list[tuple[str, str]]:
    """(clause, parent sentence) pairs.

    The parent sentence matters for timing: in
    "grants Atk/Spd+6 to unit, ..., and reduces damage during combat"
    the trailing "during combat" governs the whole sentence.
    """
    out: list[tuple[str, str]] = []
    for line in main_text(text).split("\n"):
        for line_part in split_sentences(line.strip()):
            for part in split_subclauses(line_part):
                part = part.strip(" ,;")
                if part:
                    out.append((part, line_part))
    return out


def unquoted(text: str) -> str:
    """Drop quoted status descriptions before judging a clause's timing."""
    return QUOTED_RE.sub(" ", text)


def sentence(text: str, limit: int = 200) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "\u2026"


# --------------------------------------------------------------------------- #
# modifiers
# --------------------------------------------------------------------------- #

POSSESSIVE_RE = re.compile(r"(?:unit|foe|ally|target)(?:'s|\u2019s)\s*$", re.I)
PHANTOM_RE = re.compile(
    rf"\b({STAT_ALT})(?:'s)?\s+as if granted\s*([+\-−])?\s*(\d+)", re.I)
THRESHOLD_RE = re.compile(r"(?:HP|Atk|Spd|Def|Res)\s*[≥><]=?\s*\d+\s*%?", re.I)


def parse_stat_deltas(clause: str) -> dict[str, int]:
    """{'Atk': 6, 'Spd': 6} for 'grants Atk/Spd+6'.

    Possessive forms ("unit's Spd-4", "foe's Def-6") are stat comparisons, not
    modifiers, so they are skipped; "Inflicts Spd-5" (no possessive) is a real
    change to the unit's own stat line.
    """
    found: dict[str, int] = {}
    for match in STAT_DELTA_RE.finditer(clause):
        names, sign, value = match.group(1), match.group(2), match.group(3)
        prefix = clause[max(0, match.start() - 24):match.start()]
        if POSSESSIVE_RE.search(prefix):
            continue
        amount = -int(value) if sign in "-−" else int(value)
        for name in re.split(r"\s*/\s*", names):
            found[name] = found.get(name, 0) + amount
    for stat, sign, value in PHANTOM_RE.findall(clause):
        amount = -int(value) if sign in "-−" else int(value)
        name = stat.capitalize()
        found[name] = found.get(name, 0) + amount
    return found


TURN_START_RE = re.compile(
    r"at start of turn|at the start of turn|start of player phase|start of enemy phase",
    re.I,
)
COMBAT_CONDITION_RE = re.compile(
    r"if unit initiates combat|if foe initiates combat|at the start of combat|"
    r"if unit's |if foe's ",
    re.I,
)


def clause_tier(clause: str, category: str | None = None,
                sentence: str | None = None) -> str:
    """Which modifier tier a clause belongs to.

    phantom  - "as if granted", comparison only
    combat   - only applies during combat (Blow / Stance / Solo)
    visible  - field buffs or debuffs granted for a turn / to allies
    flat     - unconditional changes to the stat line (Life and Death, seals)
    """
    low = clause.lower()
    bare = unquoted(low)
    context = unquoted((sentence or clause).lower())
    if "as if granted" in bare:
        return "phantom"
    if DURATION_RE.search(bare) or DURATION_RE.search(context) or TURN_START_RE.search(context):
        return "visible"
    if COMBAT_RE.search(bare) or COMBAT_RE.search(context) or COMBAT_CONDITION_RE.search(bare):
        return "combat"
    if "allies" in bare or "to target" in bare or "to allies" in bare:
        return "visible"
    if category == "assist":
        return "visible"
    return "flat"


def clause_target(clause: str) -> str:
    """Whose stat line the clause changes.

    An untargeted "Inflicts Spd-5" is the unit's own stat cut (Brave weapons,
    Life and Death, ...), while "Inflicts Def-6 on foe" hits the opponent.
    """
    low = clause.lower()
    if FOE_TARGET_RE.search(low) and not ALLY_TARGET_RE.search(low):
        return "foe"
    return "ally"


def add_modifier(mods: dict, target: str, tier: str, stat: str, value: int) -> None:
    bucket = mods.setdefault(target, {}).setdefault(tier, {})
    bucket[stat] = bucket.get(stat, 0) + value


def flatten_modifiers(mods: dict) -> dict[str, int]:
    flat: dict[str, int] = {}
    for target, tiers in mods.items():
        for tier, stats in tiers.items():
            for stat, value in stats.items():
                if not value:
                    continue
                key = f"{tier}_{stat.lower()}"
                if target == "foe":
                    key = f"foe_{key}"
                flat[key] = flat.get(key, 0) + value
    return dict(sorted(flat.items()))


def modifier_totals(mods: dict, target: str) -> dict[str, int]:
    """Sum every tier for one target, per stat (used for named-effect inference)."""
    totals = {stat: 0 for stat in STATS}
    for tier, stats in mods.get(target, {}).items():
        for stat, value in stats.items():
            totals[stat] = totals.get(stat, 0) + value
    return totals


# --------------------------------------------------------------------------- #
# named effects + synergy targets
# --------------------------------------------------------------------------- #

EFFECT_ORDER = {entry["id"]: index for index, entry in enumerate(EFFECTS)}
EFFECT_PROVIDES = {entry["id"]: entry["provides"] for entry in EFFECTS}


NEGATION_RE = re.compile(r"neutraliz\w*[^.]{0,60}$", re.I)
PATTERN_EFFECTS = [
    (entry["id"],
     [re.compile(pattern, re.I) for pattern in entry["patterns"]],
     entry.get("negatable", False))
    for entry in EFFECTS
    if entry["patterns"]
]


def pattern_effects(text: str) -> set[str]:
    found: set[str] = set()
    for effect_id, patterns, negatable in PATTERN_EFFECTS:
        for pattern in patterns:
            matched = False
            for match in pattern.finditer(text):
                if negatable and NEGATION_RE.search(text[max(0, match.start() - 60):match.start()]):
                    continue
                matched = True
                break
            if matched:
                found.update(EFFECT_PROVIDES.get(effect_id, [effect_id]))
                break
    return found


def derived_effects(mods: dict) -> set[str]:
    found: set[str] = set()
    ally = mods.get("ally", {})
    foe = mods.get("foe", {})
    if any(v > 0 for v in ally.get("visible", {}).values()):
        found.add("visible_buff_grant")
    if any(v > 0 for v in ally.get("flat", {}).values()):
        found.add("flat_stat_boost")
    if ally.get("phantom"):
        found.add("phantom_stat")
    if any(v > 0 for v in ally.get("combat", {}).values()):
        found.add("combat_stat_boost")
    if any(v < 0 for v in foe.get("visible", {}).values()):
        found.add("visible_debuff_apply")
    if any(v < 0 for v in foe.get("combat", {}).values()):
        found.add("combat_stat_debuff")
    return found


def check_stats(text: str) -> list[str]:
    stats: list[str] = []
    for pattern in CHECK_STAT_PATTERNS:
        for match in re.finditer(pattern, text, re.I):
            stat = match.group(1).capitalize()
            if stat not in stats:
                stats.append(stat)
    return [stat for stat in STATS if stat in stats]


def positive_match(pattern: str, text: str) -> bool:
    """True when the pattern matches outside a "neutralizes ..." clause."""
    for match in re.finditer(pattern, text, re.I):
        prefix = text[max(0, match.start() - 60):match.start()]
        if NEGATION_RE.search(prefix):
            continue
        return True
    return False


def synergy_targets(text: str, named: set[str], category: str, cd: int | None,
                    checks: list[str]) -> list[str]:
    targets: set[str] = set()
    for target, patterns in TARGET_RULES:
        if any(positive_match(pattern, text) for pattern in patterns):
            targets.add(target)

    if category == "special" and (cd or 0) >= 3:
        targets.add("high_cooldown_special")
    if checks:
        targets.add("stat_comparison")
    if {"null_follow_up", "guaranteed_follow_up", "brave_attack", "follow_up_denial"} & named:
        targets.add("follow_up_control")
    if "damage_reduction" in named and "healing" not in named and category != "weapon":
        targets.add("sustain")
    # A skill that heals itself does not need a sustain partner.
    if "healing" in named:
        targets.discard("sustain")
    # A skill that already provides what it needs does not need a partner for it.
    targets -= {target for target in targets if target in named and target not in SYNERGY_RULES}
    return sorted(targets, key=lambda target: EFFECT_ORDER.get(target, 999))


# --------------------------------------------------------------------------- #
# skill analysis
# --------------------------------------------------------------------------- #

CLAUSE_PRIORITY = {"buff": 0, "debuff": 0, "flat": 1, "const": 2, "other": 3}


def classify_clause(clause: str, deltas: dict[str, int], target: str, tier: str):
    low = clause.lower()
    if deltas:
        return "debuff" if target == "foe" else "buff"
    if "reduces damage" in low or TRUE_DAMAGE_RE.search(low) or HEAL_RE.search(low):
        return "flat"
    if CONST_RE.search(clause):
        return "const"
    return "other"


def analyse_skill(desc: str, category: str, cd: int | None, name: str = "") -> dict:
    body = main_text(desc)
    mods: dict = {}
    clauses: list[list] = []
    seen: set[str] = set()

    for clause, sentence_text in split_clauses(desc):
        low = clause.lower()
        if len(low) < 12:
            continue
        if low.startswith("(") and low.endswith(")"):
            continue
        if (len(clause) < 80 and FRAGMENT_RE.match(clause.rstrip(". "))
                and not EFFECT_VERB_RE.search(clause)):
            continue
        if clause in seen:
            continue
        seen.add(clause)

        deltas = parse_stat_deltas(clause)
        target = clause_target(clause)
        tier = clause_tier(clause, category, sentence_text)
        # "treats unit's Spd as if granted +7" boosts the unit's own comparison.
        if tier == "phantom":
            target = "ally"

        if deltas:
            for stat, value in deltas.items():
                add_modifier(mods, target, tier, stat, value)

        kind = classify_clause(clause, deltas, target, tier)
        clauses.append([kind, target, tier, sentence(clause)])

    named = pattern_effects(body) | derived_effects(mods) | name_effects(name)
    checks = check_stats(body)
    targets = synergy_targets(body, named, category, cd, checks)

    clauses.sort(key=lambda row: (CLAUSE_PRIORITY.get(row[0], 9), row[2] != "combat"))
    dropped = sum(1 for row in clauses if row[0] == "other")
    kept = [row for row in clauses if row[0] != "other"][:8]
    if not kept:
        kept = clauses[:4]
    elif dropped and len(kept) < 8:
        kept += [row for row in clauses if row[0] == "other"][: 8 - len(kept)]

    return {
        "named_effects": sorted(named, key=lambda effect: EFFECT_ORDER.get(effect, 999)),
        "flat_modifiers": flatten_modifiers(mods),
        "synergy_targets": targets,
        "check_stats": checks,
        "clauses": kept,
        "mods": mods,
    }


# --------------------------------------------------------------------------- #
# build
# --------------------------------------------------------------------------- #

def clean_name(name: str) -> str:
    return re.sub(r"\s+", " ", name or "").strip()


def build(source: Path, out_dir: Path) -> None:
    skills_raw = load(source / "skills.json")
    try:
        descriptions = {row["id"]: row for row in load(source / "skills-descriptions.json")}
    except FileNotFoundError:
        descriptions = {}
    units_raw = load(source / "units.json")
    try:
        learn_raw = load(source / "skills_units.json")
    except FileNotFoundError:
        learn_raw = []

    raw_by_id = {row["id"]: row for row in skills_raw}
    refines_of: dict[str, list[str]] = {}
    for row in skills_raw:
        base = row.get("base_id")
        if base:
            refines_of.setdefault(base, []).append(row["id"])

    skills: list[dict] = []
    by_id: dict[str, dict] = {}

    for raw in skills_raw:
        category = raw.get("category")
        if category not in SLOT_BY_CATEGORY:
            continue

        desc = norm_text((descriptions.get(raw["id"]) or {}).get("full"))
        # Refine variants repeat their base skill's restrictions and prf status;
        # the raw export marks every refine as prf, which would hide generic ones.
        base_raw = raw_by_id.get(raw.get("base_id") or "")
        restricted = raw.get("restrictions") or (base_raw or {}).get("restrictions") or {}
        is_prf = bool(base_raw.get("is_prf")) if base_raw else bool(raw.get("is_prf"))
        cd = raw.get("cd")

        analysis = analyse_skill(desc, category, cd, clean_name(raw.get("name")))
        entry = {
            "id": raw["id"],
            "name": clean_name(raw.get("name")),
            "slot": SLOT_BY_CATEGORY[category],
            "cat": category,
            "sp": raw.get("sp"),
            "tier": raw.get("tier"),
            "wt": raw.get("weapon_type"),
            "cd": cd,
            "mt": raw.get("might"),
            "rng": raw.get("range"),
            "prf": is_prf,
            "res": restricted,
            "desc": desc,
            "named_effects": analysis["named_effects"],
            "flat_modifiers": analysis["flat_modifiers"],
            "synergy_targets": analysis["synergy_targets"],
            "check_stats": analysis["check_stats"],
            "clauses": analysis["clauses"],
        }
        if raw.get("base_id"):
            entry["base"] = raw["base_id"]
            entry["refine"] = raw.get("refine_kind")
        skills.append(entry)
        by_id[raw["id"]] = entry

    skills.sort(key=lambda s: (s["slot"], s["name"].lower()))

    prf_by_unit: dict[str, list[str]] = {}
    kit: dict[str, dict] = {}
    for row in learn_raw:
        skill = by_id.get(row.get("skill_id"))
        if not skill:
            continue
        uid = row.get("unit_id")
        if skill["prf"]:
            owned = prf_by_unit.setdefault(uid, [])
            # A hero can also equip the refines of their own prf skills.
            for skill_id in [skill["id"], *refines_of.get(skill["id"], [])]:
                if skill_id in by_id and skill_id not in owned:
                    owned.append(skill_id)
        default = row.get("default") or 0
        if default > 0:
            current = kit.setdefault(uid, {})
            if skill["cat"] not in current or default > current[skill["cat"]][1]:
                current[skill["cat"]] = (skill["id"], default)

    units = []
    for raw in units_raw:
        uid = raw["id"]
        units.append({
            "id": uid,
            "name": clean_name(raw.get("full_name") or raw.get("name")),
            "wt": raw.get("weapon_type"),
            "mv": raw.get("move_type"),
            "book": raw.get("book"),
            "ver": raw.get("version"),
            "kit": {slot: value[0] for slot, value in kit.get(uid, {}).items()},
            "prf": prf_by_unit.get(uid, []),
        })
    units.sort(key=lambda u: u["name"].lower())

    out_dir.mkdir(parents=True, exist_ok=True)
    write_json(out_dir / "skills.json", skills)
    write_json(out_dir / "units.json", units)
    write_json(out_dir / "effects.json", catalog())

    print(f"skills: {len(skills)}  units: {len(units)}")
    for name in ("skills.json", "units.json", "effects.json"):
        path = out_dir / name
        print(f"  {path}  {path.stat().st_size / 1024:.0f} KiB")
    report(skills)


def report(skills: list[dict]) -> None:
    """Print a short coverage summary, useful after a data refresh."""
    from collections import Counter

    effects = Counter()
    targets = Counter()
    for skill in skills:
        effects.update(skill["named_effects"])
        effects.update(f"+{target}" for target in skill["synergy_targets"])
        targets.update(skill["synergy_targets"])
    print("\ntop named effects:")
    for effect, count in effects.most_common(14):
        print(f"  {count:5d}  {effect}")
    print("\nsynergy targets:")
    for target, count in sorted(targets.items()):
        print(f"  {count:5d}  {target}")


def write_json(path: Path, payload) -> None:
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=root / "feh-data" / "data")
    parser.add_argument("--out", type=Path, default=root / "data")
    args = parser.parse_args()
    if not (args.source / "skills.json").exists():
        raise SystemExit(
            f"missing {args.source / 'skills.json'}\n"
            "Clone the data first:\n"
            "  git clone https://github.com/matxx/feh-data feh-data\n"
            "or pass --source /path/to/feh-data/data"
        )
    build(args.source, args.out)


if __name__ == "__main__":
    main()
