# FEH Skill Synergy Matcher

A small, dependency-free web tool for *Fire Emblem Heroes*: pick a hero, load their default kit,
and see what the build actually does — which named effects it brings, what it adds to each stat
tier, and which skills best fill the empty slots.

Live site: <https://feelinlucky.github.io/feh-skill-matcher/>

## Layout

```
 character
 skill set          effect breakdown        accumulated constants
 ┌──────────┐       ┌────────────────┐      ┌──────────────────────────────┐
 │ weapon   │       │ named effects  │      │        target   target       │
 │ special  │       │ field buffs    │      │ stat     ally     foe        │
 │ skill A  │       │ field debuffs  │      │ Atk      +6        −6        │
 │ skill B  │       │ flat changes   │      │ Spd      +9        —         │
 │ skill C  │       │ during combat  │      │ Def      —         −4        │
 │ seal     │       │ constants      │      │ Res      +3        —         │
 │ skill X  │       └────────────────┘      └──────────────────────────────┘
 ├ filters  │
 suggested complements
```

* Every slot is a searchable dropdown filtered by the selected hero's weapon / movement
  restrictions. Refine variants are listed next to their base skill and prf skills only appear
  for the hero who owns them.
* Choosing a hero prefills the slots with that hero's default (base kit) skills.
* **effect breakdown** shows the build's named effects grouped by family, then the raw wording
  split into field buffs/debuffs, flat stat changes, phantom stats, during-combat buffs/debuffs,
  flat modifiers and constants.
* **accumulated constants** adds the numbers per stat for **target: ally** (what the build grants)
  and **target: foe** (what it inflicts), keeps each tier separate, and shows the net swing.
* **suggested complements** ranks inherit-able skills for every empty slot, explains *why* each one
  fits (e.g. "Flat Spd — clears Godlike Reflexes' Spd check"), and fills the slot on click.
* **filters** narrow the slot lists and the suggestions by movement type, weapon type and the named
  effect a skill grants.
* The current build is mirrored in the URL hash, so a build can be bookmarked or shared.

## Modifier taxonomy

Every stat a skill moves is filed under one of four tiers, because they behave differently in game:

| tier | meaning | examples |
| --- | --- | --- |
| `visible` | field buff / debuff granted for a turn or through the next action | Hone, Rally, Oath's +6, Panic penalties |
| `flat` | unconditional change to the stat line | Life and Death, Solid Ground, seals, Brave weapons' own Spd−5 |
| `phantom` | "treats *stat* as if granted +N" — comparison only | Phantom Spd, Close Call 4, Dodge |
| `combat` | only applies during combat (Blow / Stance / Solo / Lull) | Death Blow, Atk/Def Solo, Cantrips |

`data/skills.json` stores them as `flat_modifiers`, keyed `[foe_]<tier>_<stat>` and signed as the
wording reads, e.g. `{"visible_atk": 6, "combat_spd": 3, "foe_combat_def": -4, "phantom_spd": 7}`.
Foe-prefixed keys describe what the skill does to the *opponent's* stat line.

## Named effects

FEH skills are built out of discrete mechanics (Canto, Null Follow-Up, Bonus Doubler, Tempo,
Exposure, Discord, Sabotage, …). `scripts/effects_catalog.py` is the single source of truth for
that vocabulary: ~75 constants with a label, a family, a glossary description and the regexes that
detect them. It is published to the browser as `data/effects.json`, so the parser and the synergy
engine can never drift apart.

Each skill carries two lists:

* `named_effects` — what it **provides** (`null_follow_up`, `canto`, `visible_buff_grant`, …).
  Skills that combine mechanics carry several at once.
* `synergy_targets` — what it **needs from another slot**
  (`visible_buff_scaling`, `penalty_scaling`, `high_cooldown_special`, `stat_comparison`,
  `follow_up_control`, `sustain`).

Matching is the intersection of the two across slots:

```
selected skill.synergy_targets  ×  candidate.skill.named_effects   →  suggestion
```

Every provider/target pair has a weight and a human-readable rationale in `SYNERGY_RULES`, which
is what the suggestion cards display. Stat-based targets (`stat_comparison`) are scored from the
stat line instead, weighting `phantom` above `flat` above `visible` above `combat`, so a Phantom
Spd seal is ranked as the best answer to a Spd check.

### Skill schema

```json
{
  "id": "SID_攻撃速さの信義4",
  "name": "Atk/Spd Oath 4",
  "slot": "C",
  "cat": "passivec",
  "sp": 300,
  "named_effects": ["combat_stat_boost", "visible_buff_grant"],
  "flat_modifiers": { "visible_atk": 6, "visible_spd": 6, "combat_atk": 3, "combat_spd": 3 },
  "synergy_targets": [],
  "check_stats": [],
  "clauses": [["buff", "ally", "visible", "At start of turn, … grants Atk/Spd+6 …"]],
  "ver": 1005,
  "exclusive": false,
  "max_tier": true,
  "is_sub_tier": false,
  "recommendable": true,
  "desc": "At start of turn, …"
}
```

`check_stats` lists the stats a skill compares (e.g. `["Spd"]` for anything with a Spd check), which
drives both `stat_comparison` matching and the "clears X's Spd check" reasons.

## Data

Skill data comes from [`matxx/feh-data`](https://github.com/matxx/feh-data), cloned into `feh-data/`
(kept out of Git — the export is ~50 MB). It is too large and too raw to ship as is, so
`scripts/build_data.py` pre-computes everything the page needs:

| source | output | contents |
| --- | --- | --- |
| `data/skills.json`, `data/skills-descriptions.json` | `data/skills.json` | 3,500 skills (from 6,350 raw) with slot, SP, might, cooldown, restrictions, wording, modifier tiers, named effects, synergy targets and the top-tier flags described below |
| `data/units.json`, `data/skills_units.json` | `data/units.json` | 1,400+ heroes with weapon / move type, default kit and own prf skills |
| `scripts/effects_catalog.py` | `data/effects.json` | the named-effect catalog and the synergy rule table |
| `scripts/meta_rules.py` | `data/meta.json` | the top-tier policy: SP floors, prf/sub-tier rules and the sort order the UI applies |

Rebuild after updating the data:

```bash
# first time only — the raw export (~50 MB) is not committed
git clone https://github.com/matxx/feh-data feh-data

python3 scripts/build_data.py                                  # writes data/*.json
python3 scripts/build_data.py --source /path/to/feh-data/data   # or point at an existing clone
```

The generated files are committed so GitHub Pages can serve the site without the raw export.

Parsing is heuristic: wording is split into sentences and sub-clauses (quote- and paren-aware),
tiers come from the timing of the whole sentence, and named effects come from the catalog regexes
plus the skill's own name (so "Bonus Doubler 4" provides `bonus_doubler` even though its wording
never says it). It is a readable summary, not a rules engine — always check the in-game text for
exact behaviour.

## Top-tier recommendations

The matcher is meant to suggest what to *inherit today*, so it never leads with a skill that has
already been superseded or that no other hero can hold. Two gates run before a card is drawn.

**1. No unit-exclusive (prf) skills.** Every skill is tagged from the raw export's `is_prf` /
`base_id` information. `exclusive: true` rows (Fólkvangr, Great Aether, Beorc's Blessing, every
refine) are dropped from suggestions and from the slot dropdowns unless the hero already has them
in their default kit — a kit must still render its own prf weapon.

**2. Only the terminal tier of a family.** The build walks each skill's `upgrade_ids` to build an
`upgrades_of` graph, then keeps only skills with no successor. Each entry carries the flags the UI
uses:

| field | meaning |
| --- | --- |
| `exclusive` | prf / hero-locked — never recommended |
| `max_tier` | has no higher tier in its family (terminal node) |
| `is_sub_tier` | a prerequisite of something else (kept only when a default kit needs it) |
| `recommendable` | `max_tier && !exclusive && sp >= floor` — the single gate the UI trusts |
| `ver` | release version encoded as an integer (`"10.10"` → `1010`) so sorting is chronological |

The SP floor per slot lives in `scripts/meta_rules.py` and is mirrored into `data/meta.json`:

| slot | floor | why |
| --- | --- | --- |
| weapon | 300 | refined/PRF-era weapons sit at 300+; older 200-SP weapons are legacy |
| assist | 150 | movement/dual assists are 150; Reposition-class utility stays available |
| special | 500 | modern specials (Godlike Reflexes, Armored Beacon…) are 500 |
| A / B / C | 300 | tier-4 passives are 300; tier-3 and below are legacy |
| sacred seal | 240 | seals top out at 240 |
| X (echo) | 0 | echoes carry no SP in the export |

A skill that is a prerequisite of something else is suppressed even when its own SP clears the
floor (Swift Sparrow 2 → Sly Swift Sparrow), because holding the lower tier is never the goal.
Rows that a hero's default kit references are kept regardless, and flagged `is_sub_tier`, so
loading a hero never leaves an empty slot. Skipped rows are counted in the build report:

```
skills: 3533 units: 1427
  pruned 2702 legacy entries (prerequisites / below SP floor, not referenced by any default kit)

per slot: total / recommendable / exclusive
  A          256 /   181 /    75
  ...
```

**Ordering.** Synergy decides *which* skills qualify — a candidate still needs a named-effect or
stat reason to appear — but the displayed list is then ordered top-tier first:
relevance shortlist (≥ 60% of the best score, padded for thin slots) → **SP desc → release version
desc → name asc**. The slot dropdowns use the same `SP → version → name` order, so the newest tier-4
passive sits at the top of the list instead of the beta-era skill with the best stat line.

**The scope switch.** The *include prf & off-meta* chip in the filter panel relaxes both gates for
browsing: unit-exclusive skills and prerequisite rows that survived the build become selectable and
can be read on a hero. Because the build deletes the rest, the switch cannot resurrect fully pruned
legacy rows (Fury 3 is not in the data at all). To inspect the complete historical list, rebuild
with:

```bash
python3 scripts/build_data.py --keep-legacy   # skip prune_legacy(), keep every row
```

`data/meta.json` records the active policy (`spFloors`, `floorNotes`, `slotLabels`, `rules`,
`pruned`), and the UI reads it at runtime — so the floors and the note in the filter panel always
match the data file that shipped with them.

## Development

It is a static site; no build step is needed for the frontend.

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Files:

* `index.html` — page structure
* `styles.css` — layout and theme
* `app.js` — dropdowns, filters, effect grouping, tier accumulation, synergy engine
* `scripts/build_data.py` — data pipeline from `feh-data`
* `scripts/effects_catalog.py` — named-effect constants, parser rules and synergy weights
* `scripts/meta_rules.py` — SP floors, version encoding and the recommendability policy

Fire Emblem Heroes is © Nintendo / Intelligent Systems. This is an unofficial fan project.
