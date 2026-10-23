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
| `data/skills.json`, `data/skills-descriptions.json` | `data/skills.json` | 6,200+ skills with slot, SP, might, cooldown, restrictions, wording, modifier tiers, named effects and synergy targets |
| `data/units.json`, `data/skills_units.json` | `data/units.json` | 1,400+ heroes with weapon / move type, default kit and own prf skills |
| `scripts/effects_catalog.py` | `data/effects.json` | the named-effect catalog and the synergy rule table |

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

Fire Emblem Heroes is © Nintendo / Intelligent Systems. This is an unofficial fan project.
