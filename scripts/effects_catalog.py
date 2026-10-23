"""Named-effect constants for FEH skills.

This module is the single source of truth for the vocabulary shared by the
data pipeline (`build_data.py`) and the frontend: the parser tags skills with
these ids, the catalog is published as `data/effects.json`, and the synergy
engine keys its rules on the same ids.

Two kinds of entry live here:

* ``status`` / ``mechanic`` / ``derived`` effects are things a skill *provides*
  (``null_follow_up``, ``canto``, ``visible_buff_grant``, ...).
* ``target`` effects are things a skill *needs from another skill*
  (``visible_buff_scaling``, ``high_cooldown_special``, ...).

A skill therefore carries ``named_effects`` (what it provides) and
``synergy_targets`` (what it wants), and matching is the intersection of the
two across slots.
"""
from __future__ import annotations

import re

GROUPS = [
    ("field", "field status"),
    ("followup", "follow-up control"),
    ("special", "special / cooldown"),
    ("damage", "damage & mitigation"),
    ("movement", "movement & positioning"),
    ("scaling", "scaling & stat checks"),
    ("modifier", "modifier grants"),
    ("target", "what a skill needs"),
]


def effect(id, label, group, kind, desc, patterns=(), provides=None,
           negatable=False):
    """One named effect.

    ``patterns`` are case-insensitive regexes searched in the skill wording.
    ``provides`` lets an effect satisfy synergy providers other than itself
    (e.g. ``【Bonus Doubler】`` also acts as a ``stat_scaling`` provider).
    ``negatable`` marks effects whose wording is often *negated* by a nearby
    "neutralizes", e.g. "neutralizes ... reduces damage by X%".
    """
    return {
        "id": id,
        "label": label,
        "group": group,
        "kind": kind,
        "desc": desc,
        "patterns": list(patterns),
        "provides": list(provides or [id]),
        "negatable": negatable,
    }


# --- field statuses ---------------------------------------------------------

FIELD_STATUS = [
    effect("panic", "Panic", "field", "status",
           "Bonuses on the unit are converted into penalties.",
           [r"【Panic】"]),
    effect("exposure", "Exposure", "field", "status",
           "Foe's attacks deal +10 damage.",
           [r"【Exposure】"]),
    effect("discord", "Discord", "field", "status",
           "Inflicts Atk/Spd/Def/Res-X during combat (grows with nearby allies).",
           [r"【Discord】"]),
    effect("sabotage", "Sabotage", "field", "status",
           "Inflicts penalties equal to the highest penalty nearby.",
           [r"【Sabotage】"]),
    effect("undefended", "Undefended", "field", "status",
           "The target cannot be protected by Savior.",
           [r"【Undefended】"]),
    effect("isolation", "Isolation", "field", "status",
           "The target cannot use or be targeted by Assist skills.",
           [r"【Isolation】"]),
    effect("gravity", "Gravity", "field", "status",
           "Restricts the target's movement to 1 space.",
           [r"【Gravity】"]),
    effect("stall", "Stall", "field", "status",
           "Neutralises \"unit can move 1 extra space\" effects on the target.",
           [r"【Stall】"]),
    effect("frozen", "Frozen", "field", "status",
           "Worsens the target's follow-up ability and improves the foe's.",
           [r"【Frozen】"]),
    effect("deep_wounds", "Deep Wounds", "field", "status",
           "The target's HP cannot be healed.",
           [r"【Deep Wounds】"]),
    effect("feud", "Feud", "field", "status",
           "Disables all ally skills (excluding the unit's) during combat.",
           [r"【Feud】"]),
    effect("schism", "Schism", "field", "status",
           "Neutralises Triangle Attack, Dual Strike and Pathfinder on the unit.",
           [r"【Schism】"]),
    effect("en_garde", "En Garde", "field", "status",
           "Neutralises out-of-combat damage (except area-of-effect Specials).",
           [r"【En Garde】"]),
    effect("null_panic", "Null Panic", "field", "status",
           "Blocks Panic's bonus-to-penalty conversion.",
           [r"【Null Panic】"]),
    effect("drain_cancel", "Drain Cancel", "field", "status",
           "Blocks bonus-stealing effects such as Essence Drain.",
           [r"【Drain Cancel】"]),
    effect("canto_control", "Canto Control", "field", "status",
           "Limits how far the target can move with Canto.",
           [r"【Canto Control】"]),
    effect("ploy", "Ploy", "field", "status",
           "Neutralises Bonus Doubler, Treachery and Grand Strategy on the target.",
           [r"【Ploy】"]),
    effect("divine_vein", "Divine Vein", "field", "status",
           "Applies a terrain/space effect such as Flame, Ice or Stone.",
           [r"【Divine Vein"]),
    effect("hexblade", "Hexblade", "field", "status",
           "Damage is calculated with the lower of the foe's Def or Res.",
           [r"【Hexblade】"], provides=["adaptive_damage"]),
    effect("empathy", "Empathy", "field", "status",
           "Bonus scaling driven by the types of Bonus/Penalty effects in play.",
           [r"【Empathy】"]),
    effect("anathema", "Anathema", "field", "status",
           "Inflicts Spd/Def/Res-4 on foes within 3 spaces during combat.",
           [r"【Anathema】"]),
]

# --- movement / positioning -------------------------------------------------

MOVEMENT = [
    effect("canto", "Canto", "movement", "status",
           "The unit can move again after acting (range varies by Canto type).",
           [r"【Canto", r"\bEnables【Canto"]),
    effect("pathfinder", "Pathfinder", "movement", "status",
           "Allies treat the unit's space as 0 movement.",
           [r"【Pathfinder】"]),
    effect("charge", "Charge", "movement", "status",
           "Grants Warp-style movement up to 3 spaces.",
           [r"【Charge】", r"【True Charge】"]),
    effect("savior", "Savior", "movement", "status",
           "Takes an ally's space and enters combat in their place.",
           [r"【Savior】"]),
    effect("bulwark", "Bulwark", "movement", "status",
           "Blocks nearby foes from moving through adjacent spaces.",
           [r"【Bulwark】"]),
]

# --- follow-up control ------------------------------------------------------

FOLLOW_UP = [
    effect("null_follow_up", "Null Follow-Up", "followup", "mechanic",
           "Neutralises effects that guarantee the foe's or prevent the unit's follow-up.",
           [r"【Null Follow-Up】",
            r"neutralizes effects that guarantee foe's follow-up attacks and effects that prevent unit's follow-up attacks",
            r"neutralizes effects that prevent unit's follow-up attacks and effects that guarantee foe's follow-up attacks"]),
    effect("guaranteed_follow_up", "Guaranteed follow-up", "followup", "mechanic",
           "The unit makes a guaranteed follow-up attack.",
           [r"guaranteed follow-up attack"]),
    effect("follow_up_denial", "Follow-up denial", "followup", "mechanic",
           "Prevents the foe from making a follow-up attack.",
           [r"prevents foe's follow-up", r"foe cannot make a follow-up attack",
            r"foe cannot make a follow-up"]),
    effect("desperation", "Desperation", "followup", "status",
           "The unit's follow-up lands before the foe can counterattack.",
           [r"【Desperation】", r"follow-up attack before foe can counterattack"]),
    effect("vantage", "Vantage", "followup", "mechanic",
           "The unit counterattacks before the foe's first attack.",
           [r"【Vantage】", r"unit can counterattack before foe's first attack"]),
    effect("null_c_disrupt", "Null C-Disrupt", "followup", "mechanic",
           "Neutralises effects that prevent the unit's counterattacks.",
           [r"neutralizes effects that prevent unit's counterattacks"]),
    effect("sweep", "Sweep", "followup", "mechanic",
           "The foe cannot counterattack at all.",
           [r"foe cannot counterattack"]),
    effect("brave_attack", "Brave attack", "followup", "mechanic",
           "The unit attacks twice when initiating.",
           [r"unit attacks twice"]),
    effect("spd_preempt", "Spd Preempt", "followup", "mechanic",
           "Counterattacks before the foe's first attack when faster.",
           [r"counterattack before foe's first attack"]),
    effect("potent_follow", "Potent Follow", "followup", "status",
           "Extra follow-up strike that deals a share of normal damage.",
           [r"【Potent Follow"]),
    effect("preempt_pulse", "Preempt Pulse", "followup", "status",
           "Grants cooldown count-1 before the unit's first attack.",
           [r"【Preempt Pulse】"], provides=["preempt_pulse", "special_jump"]),
]

# --- special / cooldown -----------------------------------------------------

SPECIAL = [
    effect("special_acceleration", "Special charge +1", "special", "mechanic",
           "Grants Special cooldown charge +1 per attack.",
           [r"cooldown charge \+1", r"accelerates special trigger"]),
    effect("special_jump", "Special jump", "special", "mechanic",
           "Grants Special cooldown count-X outright.",
           [r"grants?[^.]{0,90}cooldown count-\d",
            r"cooldown count-\d+ to (?:unit|ally|target)",
            r"reduces? (?:the )?(?:unit's )?special cooldown"]),
    effect("tempo", "Tempo", "special", "mechanic",
           "Neutralises \"Special cooldown charge -X\" effects on the unit.",
           [r'neutralizes effects that inflict "special cooldown charge -x"',
            r"neutralizes effects that inflict .special cooldown charge"]),
    effect("cooldown_guard", "Guard", "special", "mechanic",
           "Inflicts Special cooldown charge -1 on the foe.",
           [r"【Guard】", r"special cooldown charge -1 on (?:the )?foe",
            r"cooldown count\+1 on foe"]),
]

# --- damage / mitigation ----------------------------------------------------

DAMAGE = [
    effect("true_damage", "True damage", "damage", "mechanic",
           "Adds flat or scaling damage that bypasses mitigation.",
           [r"deals? \+\d+ damage", r"damage = \d+% of"]),
    effect("effective_damage", "Effective damage", "damage", "mechanic",
           "Deals effective damage against a foe class.",
           [r"effective against"]),
    effect("adaptive_damage", "Adaptive damage", "damage", "mechanic",
           "Uses the lower of the foe's Def or Res.",
           [r"lower of foe's def or res"]),
    effect("damage_reduction", "Damage reduction", "damage", "mechanic",
           "Reduces incoming damage, often by a stat difference.",
           [r"reduces damage (?:from|by)"], negatable=True),
    effect("healing", "Healing", "damage", "mechanic",
           "Restores HP to the unit or to allies.",
           [r"restores? \d+ hp", r"restores? hp"]),
    effect("miracle", "Miracle", "damage", "mechanic",
           "Survives a lethal hit with 1 HP.",
           [r"survives with 1 hp", r"【Miracle】"]),
    effect("recoil", "Recoil", "damage", "mechanic",
           "Deals damage to the unit itself (Fury, Push, ...).",
           [r"deals? \d+ damage to unit"]),
    effect("distant_counter", "Distant Counter", "damage", "mechanic",
           "Counterattacks regardless of the foe's range.",
           [r"counterattack regardless of foe's range"]),
    effect("refresh", "Refresh", "damage", "mechanic",
           "Grants another action to the unit or an ally.",
           [r"grants another action"]),
    effect("weapon_triangle", "Weapon triangle", "damage", "mechanic",
           "Grants or inflicts weapon-triangle advantage.",
           [r"weapon-triangle advantage"]),
]

# --- scaling / comparisons --------------------------------------------------

SCALING = [
    effect("stat_scaling", "Stat scaling", "scaling", "mechanic",
           "Adds damage or stats based on a percentage of a stat.",
           [r"= \d+% of (?:unit|foe)'s", r"% of (?:unit|foe)'s (?:atk|spd|def|res)"]),
    effect("bonus_doubler", "Bonus Doubler", "scaling", "status",
           "Grants stats equal to the unit's current visible bonuses.",
           [r"【Bonus Doubler】"],
           provides=["visible_buff_scaling"]),
    effect("grand_strategy", "Grand Strategy", "scaling", "status",
           "Grants stats equal to twice the unit's current penalties.",
           [r"【Grand Strategy】"], provides=["penalty_scaling"]),
    effect("treachery", "Treachery", "scaling", "status",
           "Deals additional damage equal to total bonuses on the unit.",
           [r"【Treachery】"], provides=["visible_buff_scaling"]),
    effect("dominance", "Dominance", "scaling", "status",
           "Deals additional damage equal to total penalties on the foe.",
           [r"【Dominance】"], provides=["penalty_scaling"]),
    effect("resonance", "Resonance", "scaling", "status",
           "Grants Atk/Spd or Def/Res during combat (Blades / Shields).",
           [r"【Resonance:"]),
    effect("liberate", "Liberate", "scaling", "status",
           "Grants a stat bonus based on the number of Bonus effects in play.",
           [r"【(?:Atk|Spd|Def|Res) Liberate】"]),
    effect("clash", "Clash", "scaling", "status",
           "Grants stats based on the distance moved into combat.",
           [r"initiates combat after moving to a different space"]),
    effect("incited", "Incited", "scaling", "status",
           "Grants stats based on the distance moved when initiating.",
           [r"【Incited】", r"【Truly Incited】"]),
    effect("great_talent", "Great Talent", "scaling", "status",
           "Raises specified stats until they reach their cap.",
           [r"【Great Talent】"]),
    effect("phantom_stat", "Phantom stat", "scaling", "mechanic",
           "Treats a stat as higher for comparison purposes only.",
           [r"as if granted"]),
]

# --- modifier grants (derived from parsed modifiers) -----------------------

MODIFIER = [
    effect("visible_buff_grant", "Visible buffs", "modifier", "derived",
           "Grants field stat bonuses that show as blue numbers."),
    effect("visible_debuff_apply", "Visible debuffs", "modifier", "derived",
           "Inflicts field stat penalties that show as red numbers."),
    effect("flat_stat_boost", "Flat stat boost", "modifier", "derived",
           "Permanently raises the stat line before combat (Life and Death, ...)."),
    effect("combat_stat_boost", "In-combat buffs", "modifier", "derived",
           "Grants stats only during combat (Blow, Stance, Solo, ...)."),
    effect("combat_stat_debuff", "In-combat debuffs", "modifier", "derived",
           "Inflicts stats only during combat (Lull, Cantrip, ...)."),
    effect("penalty_cleanse", "Penalty cleanse", "modifier", "mechanic",
           "Neutralises penalties on the unit or allies.",
           [r"neutralizes (?:any )?【?penalt", r"neutralizes penalties"]),
    effect("bonus_negation", "Bonus negation", "modifier", "mechanic",
           "Neutralises bonuses on the foe.",
           [r"neutralizes foe's bonuses", r"neutralizes (?:any )?【?bonus】? (?:on|active on) foe"]),
]

# --- targets: what a skill needs from another slot --------------------------

TARGETS = [
    effect("visible_buff_scaling", "visible buff scaling", "target", "target",
           "Performance scales with the unit's visible bonuses."),
    effect("penalty_scaling", "penalty scaling", "target", "target",
           "Performance scales with penalties on the unit or the foe."),
    effect("high_cooldown_special", "high-cooldown Special", "target", "target",
           "A Special with cooldown 3+ needs help to trigger."),
    effect("stat_comparison", "stat comparison", "target", "target",
           "The effect hinges on a stat check against the foe."),
    effect("follow_up_control", "follow-up package", "target", "target",
           "Wants the follow-up plan completed (Desperation, Vantage, Null C, ...)."),
    effect("sustain", "sustain", "target", "target",
           "Damage reduction wants healing to stay relevant."),
]

EFFECTS = FIELD_STATUS + MOVEMENT + FOLLOW_UP + SPECIAL + DAMAGE + SCALING + MODIFIER + TARGETS

EFFECT_BY_ID = {entry["id"]: entry for entry in EFFECTS}

# --- parser rules -----------------------------------------------------------

# Wording that makes a skill *need* something from another slot.
TARGET_RULES = [
    ("visible_buff_scaling", [
        r"highest bonus on each stat",
        r"【Bonus】is active on unit",
        r"current bonus on each of unit's stats",
        r"grants? bonus to .{0,60}= .{0,30}bonus",
        r"additional damage = total bonuses",
    ]),
    ("penalty_scaling", [
        r"highest penalty on each stat",
        r"【Penalty】is active on (?:the )?foe",
        r"penalty is active on (?:the )?foe",
        r"【Penalty】is active on unit",
        r"current penalty on each of unit's stats",
        r"additional damage = total penalties",
    ]),
    ("sustain", [
        r"reduces damage",
    ]),
]

# Stat used by a comparison, e.g. "unit's Spd > foe's Spd".
CHECK_STAT_PATTERNS = [
    r"unit's (Atk|Spd|Def|Res) ?[≥>≤<] ?(?:the )?foe's",
    r"(?:the )?foe's (Atk|Spd|Def|Res) ?[≥>≤<] ?unit's",
    r"compares? (?:unit|foe)'s (Atk|Spd|Def|Res)",
    r"treats (?:unit|foe)'s (Atk|Spd|Def|Res) as if granted",
    r"(?:unit|foe)'s (Atk|Spd|Def|Res) (?:≥|>|≤|<)",
]

# --- synergy engine rules ---------------------------------------------------
# target -> [(provider effect, weight, rationale shown in the UI)]
SYNERGY_RULES = {
    "visible_buff_scaling": [
        ("visible_buff_grant", 3.0, "grants visible bonuses that the scaler converts into stats"),
        ("flat_stat_boost", 2.0, "raises the base stat line the scaler works from"),
        ("bonus_doubler", 2.0, "another bonus scaler, so both feed off the same buffs"),
        ("treachery", 2.0, "turns visible bonuses into true damage"),
        ("incited", 1.0, "adds a second scaling source"),
    ],
    "penalty_scaling": [
        ("visible_debuff_apply", 3.0, "applies the penalties this skill scales from"),
        ("sabotage", 2.5, "applies penalties at combat start"),
        ("panic", 2.0, "flips the foe's bonuses into penalties"),
        ("discord", 1.5, "piles on a defence-sapping status"),
        ("exposure", 1.5, "adds a damage-boosting debuff status"),
        ("dominance", 1.5, "converts the foe's penalties into damage"),
        ("grand_strategy", 1.5, "converts the unit's penalties into stats"),
    ],
    "high_cooldown_special": [
        ("special_acceleration", 3.0, "charges the Special on every attack"),
        ("special_jump", 2.5, "shaves cooldown so the Special is ready sooner"),
        ("preempt_pulse", 2.0, "free cooldown before the first attack"),
        ("tempo", 1.5, "keeps Guard from stalling the cooldown"),
        ("cooldown_guard", 1.0, "cooldown control in the same package"),
    ],
    "stat_comparison": [
        ("phantom_stat", 3.0, "wins the stat check outright"),
        ("flat_stat_boost", 2.0, "clears the check threshold"),
        ("visible_buff_grant", 2.0, "visible bonuses count toward the check"),
        ("combat_stat_boost", 1.5, "in-combat stats count during combat"),
        ("visible_debuff_apply", 1.5, "penalties on the foe swing the comparison"),
        ("combat_stat_debuff", 1.5, "in-combat penalties widen the gap"),
        ("stat_scaling", 1.0, "scales off the same stat"),
    ],
    "follow_up_control": [
        ("desperation", 3.0, "lands the follow-up before the counterattack"),
        ("null_c_disrupt", 2.5, "keeps counterattacks available"),
        ("null_follow_up", 2.5, "completes the follow-up package"),
        ("vantage", 2.2, "lines up the first-strike plan"),
        ("guaranteed_follow_up", 2.0, "guarantees the extra hit"),
        ("follow_up_denial", 1.5, "denies the foe's follow-up in return"),
        ("sweep", 1.5, "skips the retaliation entirely"),
    ],
    "sustain": [
        ("healing", 1.6, "keeps the tank alive so damage reduction stays relevant"),
        ("miracle", 1.0, "safety net against the lethal hit"),
        ("en_garde", 0.8, "blocks chip damage from outside combat"),
    ],
}

# Provider effects that raise a specific stat, used for stat_comparison
# matching: {tier: multiplier applied to the modifier value}
STAT_TIER_WEIGHTS = {"phantom": 1.0, "flat": 0.6, "visible": 0.5, "combat": 0.4}


# Effects that a skill provides by virtue of its name even when the wording
# never spells out the named effect (Bonus Doubler 4, Null Follow-Up 3, ...).
NAME_HINTS = [
    (re.compile(r"bonus doubler", re.I), ["bonus_doubler"]),
    (re.compile(r"null follow-up", re.I), ["null_follow_up"]),
    (re.compile(r"distant counter", re.I), ["distant_counter"]),
    (re.compile(r"close counter", re.I), ["distant_counter"]),
    (re.compile(r"null c-disrupt", re.I), ["null_c_disrupt"]),
    (re.compile(r"\bdodge\b", re.I), ["damage_reduction"]),
    (re.compile(r"\btempo\b", re.I), ["tempo"]),
    (re.compile(r"^\W*guard\b|\bguard \d", re.I), ["cooldown_guard"]),
    (re.compile(r"\bdesperation\b", re.I), ["desperation"]),
    (re.compile(r"\bvantage\b", re.I), ["vantage"]),
    (re.compile(r"\bpreempt\b", re.I), ["spd_preempt"]),
    (re.compile(r"\bhexblade\b", re.I), ["hexblade"]),
    (re.compile(r"\bpanic\b", re.I), ["panic"]),
    (re.compile(r"\bexposure\b", re.I), ["exposure"]),
    (re.compile(r"\bdiscord\b", re.I), ["discord"]),
    (re.compile(r"\bsabotage\b", re.I), ["sabotage"]),
    (re.compile(r"\bsavior\b|\bnear save\b|\bfar save\b", re.I), ["savior"]),
    (re.compile(r"\bcanto\b", re.I), ["canto"]),
    (re.compile(r"\bclash\b", re.I), ["clash"]),
    (re.compile(r"\bprime\b", re.I), ["stat_scaling"]),
]


def name_effects(name: str) -> set[str]:
    found: set[str] = set()
    for pattern, effects in NAME_HINTS:
        if pattern.search(name or ""):
            found.update(effects)
    return found


def catalog() -> dict:
    """The trimmed catalog published to the frontend."""
    return {
        "groups": [{"id": gid, "label": label} for gid, label in GROUPS],
        "effects": [
            {
                "id": entry["id"],
                "label": entry["label"],
                "group": entry["group"],
                "kind": entry["kind"],
                "desc": entry["desc"],
            }
            for entry in EFFECTS
            if entry["kind"] != "target"
        ],
        "targets": [
            {"id": entry["id"], "label": entry["label"], "desc": entry["desc"]}
            for entry in EFFECTS
            if entry["kind"] == "target"
        ],
        "rules": {
            target: [
                {"provider": provider, "weight": weight, "rationale": rationale}
                for provider, weight, rationale in rules
            ]
            for target, rules in SYNERGY_RULES.items()
        },
        "statTierWeights": STAT_TIER_WEIGHTS,
    }
