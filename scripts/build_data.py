#!/usr/bin/env python3
"""Build the compact runtime dataset used by the web app from `feh-data`.

Source (https://github.com/matxx/feh-data, cloned into ./feh-data):

    feh-data/data/skills.json                skill list (category, sp, restrictions, ...)
    feh-data/data/skills-descriptions.json   skill wording
    feh-data/data/units.json                 heroes
    feh-data/data/skills_units.json          which hero learns / equips which skill

Output (committed so GitHub Pages works without the submodule):

    data/skills.json   skills + pre-computed effect breakdown
    data/units.json    heroes + their default (base) skill set + prf skill ids

Usage:
    git submodule update --init feh-data
    python3 scripts/build_data.py
    python3 scripts/build_data.py --source /path/to/feh-data/data
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

SLOT_CATEGORIES = [
    "weapon",
    "assist",
    "special",
    "passivea",
    "passiveb",
    "passivec",
    "sacredseal",
    "passivex",
]
# Categories that are tied to a specific hero and are not slottable.
NON_SLOT_CATEGORIES = {"duo", "harmonized", "emblem"}

STATS = ("Atk", "Spd", "Def", "Res")
STAT_ALT = "|".join(STATS)

STAT_DELTA_RE = re.compile(
    rf"\b((?:{STAT_ALT})(?:\s*/\s*(?:{STAT_ALT}))*)\s*([+\-−])\s*(\d+)\b"
)
TRUE_DAMAGE_RE = re.compile(r"(?:deals?|deal)\s*\+?(\d+)\s*damage", re.I)
HEAL_RE = re.compile(r"restores?\s+(\d+)\s*HP", re.I)
DR_FLAT_RE = re.compile(r"reduces damage[^.]*?by\s+(\d+)", re.I)


def load(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def norm_text(raw: str | None) -> str:
    if not raw:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", raw)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", '"')
    return text.strip()


GLOSSARY_HEADER_RE = re.compile(r"^【[^】]+】$")


def main_text(text: str) -> str:
    """Drop the trailing glossary paragraphs (【Bonus】, 【Penalty】, ...)."""
    kept: list[str] = []
    for line in text.split("\n"):
        line = line.strip()
        if GLOSSARY_HEADER_RE.match(line):
            break
        kept.append(line)
    return "\n".join(kept)


def split_sentences(text: str) -> list[str]:
    """Split on sentence boundaries, ignoring dots inside parentheses/quotes."""
    out: list[str] = []
    buffer = ""
    depth = 0
    index = 0
    while index < len(text):
        char = text[index]
        buffer += char
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        if char in ".!?" and depth == 0:
            cursor = index + 1
            while cursor < len(text) and text[cursor] in '"\u201d':
                buffer += text[cursor]
                cursor += 1
            if cursor >= len(text) or text[cursor].isspace():
                out.append(buffer.strip())
                buffer = ""
                index = cursor
                continue
        index += 1
    if buffer.strip():
        out.append(buffer.strip())
    return out


def split_clauses(text: str) -> list[str]:
    """Split wording into display-sized clauses."""
    out: list[str] = []
    for line in main_text(text).split("\n"):
        for part in split_sentences(line.strip()):
            part = part.strip()
            if part:
                out.append(part)
    return out


def parse_stats(block: str) -> dict[str, int]:
    """Collect positive Atk/Spd/Def/Res deltas from a clause, e.g. 'Atk/Spd+6'.

    Negative numbers in wording are usually stat comparisons ("foe's Spd-4")
    rather than penalties, so they are handled by the penalty branch instead.
    """
    found: dict[str, int] = {}
    for names, sign, value in STAT_DELTA_RE.findall(block):
        if sign in "-−":
            continue
        for name in re.split(r"\s*/\s*", names):
            found[name] = found.get(name, 0) + int(value)
    return found


def parse_penalties(block: str) -> dict[str, int]:
    """Collect penalty magnitudes such as 'Inflicts Atk/Spd-6 on foe'."""
    found: dict[str, int] = {}
    for names, sign, value in STAT_DELTA_RE.findall(block):
        if sign not in "-−":
            continue
        for name in re.split(r"\s*/\s*", names):
            found[name] = found.get(name, 0) + int(value)
    return found


def sentence(text: str, limit: int = 190) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "\u2026"


def add_amount(bucket: dict, stat: str, amount: int, combat: bool) -> None:
    row = bucket.setdefault(stat, [0, 0])
    row[1 if combat else 0] += amount


def analyse_skill(desc: str, category: str, cd: int | None) -> dict:
    """Heuristically classify what a skill does.

    Returns the numbers the right-hand panel accumulates (`a` = granted to the
    unit / allies, `f` = inflicted on foes, each split into visible/in-combat),
    the clause list the middle panel groups (`sum`), and synergy `tags`.
    """
    body = main_text(desc)
    lowered = body.lower()
    ally: dict[str, list[int]] = {}
    foe: dict[str, list[int]] = {}
    summaries: list[list] = []  # [kind, target, text, inCombat]
    tags: set[str] = set()

    if re.search(r"cooldown charge \+1", lowered):
        tags.add("special_acceleration")
    if re.search(r"cooldown charge -|cooldown count \+1", lowered):
        tags.add("cooldown_guard")
    if re.search(r"cooldown count-\d", lowered):
        tags.add("special_ready")
    if "neutralizes" in lowered and "penalties" in lowered:
        tags.add("penalty_cleanse")
    if "neutralizes foe's bonuses" in lowered:
        tags.add("bonus_negation")
    if "follow-up attack" in lowered:
        tags.add("follow_up")
    if "prevents foe's follow-up" in lowered:
        tags.add("follow_up_denial")
    if "another action" in lowered:
        tags.add("refresh")
    if "restores" in lowered and "hp" in lowered:
        tags.add("healing")
    if re.search(r"% of (unit|foe)'s (atk|spd|def|res)", lowered):
        tags.add("stat_scaling")
    if "as if granted" in lowered:
        tags.add("phantom_stat")
    if "effective against" in lowered:
        tags.add("effective_damage")
    if "savior" in lowered:
        tags.add("savior")
    if "canto" in lowered:
        tags.add("canto")
    if category == "special" and (cd or 0) >= 3:
        tags.add("high_cd_special")

    for clause in split_clauses(desc):
        low = clause.lower()
        if len(low) < 12:
            continue
        if low.startswith("(") and low.endswith(")"):
            continue

        deltas = parse_stats(clause)
        penalties = parse_penalties(clause)
        inflicts = bool(re.search(r"inflicts?|penalt", low))
        grants = "grant" in low
        in_combat = "during combat" in low and "for 1 turn" not in low

        if inflicts and (penalties or "penalt" in low):
            for stat, value in penalties.items():
                add_amount(foe, stat, value, in_combat)
            summaries.append(["debuff", "foe", sentence(clause), in_combat])
            tags.add("debuff")
            if not in_combat:
                tags.add("visible_debuff")
            continue

        if deltas and grants:
            for stat, value in deltas.items():
                add_amount(ally, stat, value, in_combat)
            summaries.append(["buff", "ally", sentence(clause), in_combat])
            tags.add("in_combat_buff" if in_combat else "visible_buff")
            damage = TRUE_DAMAGE_RE.search(low)
            if damage:
                summaries.append(["flat", "foe", f"deals +{damage.group(1)} damage", in_combat])
                tags.add("true_damage")
            continue

        if "reduces damage" in low and "neutraliz" not in low:
            summaries.append(["flat", "ally", sentence(clause), True])
            tags.add("damage_reduction")
            if deltas:
                for stat, value in deltas.items():
                    add_amount(ally, stat, value, True)
            continue

        if TRUE_DAMAGE_RE.search(low) or "deals +" in low:
            summaries.append(["flat", "foe", sentence(clause), in_combat])
            tags.add("true_damage")
            continue

        if "as if granted" in low:
            summaries.append(["flat", "ally", sentence(clause), in_combat])
            continue

        if "restores" in low and "hp" in low:
            summaries.append(["flat", "ally", sentence(clause), in_combat])
            tags.add("healing")
            continue

        if re.search(r"\bX\s*=|equal to|\u00d7\s*\d|\d\s*\u00d7|% of ", clause):
            summaries.append(["const", "none", sentence(clause), in_combat])
            if grants or "+X" in clause:
                tags.add("stat_scaling")
            if grants and in_combat:
                tags.add("in_combat_buff")
            continue

        if inflicts:
            summaries.append(["debuff", "foe", sentence(clause), in_combat])
            tags.add("debuff")
            continue

        if grants:
            summaries.append(["buff", "ally", sentence(clause), in_combat])
            continue

        summaries.append(["other", "none", sentence(clause), in_combat])

    # Drop repeated wording (refines sometimes repeat a base clause) and keep
    # the payload small while retaining the most informative entries.
    seen: set[str] = set()
    unique: list[list] = []
    for row in summaries:
        if row[2] in seen:
            continue
        seen.add(row[2])
        unique.append(row)
    priority = {"buff": 0, "debuff": 0, "flat": 1, "const": 2, "other": 3}
    unique.sort(key=lambda row: priority.get(row[0], 9))
    summaries = unique[:7]

    # Tags implied by accumulations (e.g. a purely numeric wording).
    if any(v[0] for v in ally.values()):
        tags.add("visible_buff")
    if any(v[0] for v in foe.values()):
        tags.update({"debuff", "visible_debuff"})

    return {"a": ally, "f": foe, "sum": summaries, "tags": sorted(tags)}


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

    skills = []
    by_id: dict[str, dict] = {}

    for raw in skills_raw:
        category = raw.get("category")
        if category in NON_SLOT_CATEGORIES or category not in SLOT_CATEGORIES:
            continue
        desc = norm_text((descriptions.get(raw["id"]) or {}).get("full"))
        # Refine variants repeat their base skill's restrictions and prf status;
        # the raw export marks every refine as prf, which would hide generic ones.
        base_raw = raw_by_id.get(raw.get("base_id") or "")
        restricted = (raw.get("restrictions") or (base_raw or {}).get("restrictions") or {})
        is_prf = bool(base_raw.get("is_prf")) if base_raw else bool(raw.get("is_prf"))
        cd = raw.get("cd")
        entry = {
            "id": raw["id"],
            "name": clean_name(raw.get("name")),
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
            "fx": analyse_skill(desc, category, cd),
        }
        if raw.get("base_id"):
            entry["base"] = raw["base_id"]
            entry["refine"] = raw.get("refine_kind")
        skills.append(entry)
        by_id[raw["id"]] = entry

    skills.sort(key=lambda s: (s["cat"], s["name"].lower()))

    units = []
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
            slot = skill["cat"]
            if slot not in current or default > current[slot][1]:
                current[slot] = (skill["id"], default)

    for raw in units_raw:
        uid = raw["id"]
        default_kit = {slot: sid for slot, (sid, _) in kit.get(uid, {}).items()}
        units.append(
            {
                "id": uid,
                "name": clean_name(raw.get("full_name") or raw.get("name")),
                "wt": raw.get("weapon_type"),
                "mv": raw.get("move_type"),
                "book": raw.get("book"),
                "ver": raw.get("version"),
                "kit": default_kit,
                "prf": prf_by_unit.get(uid, []),
            }
        )

    units.sort(key=lambda u: u["name"].lower())

    out_dir.mkdir(parents=True, exist_ok=True)
    write_json(out_dir / "skills.json", skills)
    write_json(out_dir / "units.json", units)

    print(f"skills: {len(skills)}  units: {len(units)}")
    for path in (out_dir / "skills.json", out_dir / "units.json"):
        print(f"  {path}  {path.stat().st_size / 1024:.0f} KiB")


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
