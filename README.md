# FEH Skill Synergy Matcher

A small, dependency-free web tool for *Fire Emblem Heroes*: pick a hero, load their default kit,
and see what the build actually does — what it grants to the unit and allies, what it inflicts on
foes, which constants stack up, and which skills best fill the empty slots.

Live site: <https://feelinlucky.github.io/feh-skill-matcher/>

## Layout

The page follows the UI draft:

```
 character
 skill set          effect breakdown        accumulated constants
 ┌──────────┐       ┌────────────────┐      ┌──────────────────────────────┐
 │ weapon   │       │ flat modifier  │      │        target   target       │
 │ special  │       │ buffs          │      │ stat     ally     foe        │
 │ skill A  │       │ debuffs        │      │ Atk      +6        −6        │
 │ skill B  │       │ during combat  │      │ Spd      +9        —         │
 │ skill C  │       │   buffs        │      │ Def      —         −4        │
 │ seal     │       │   debuffs      │      │ Res      +3        —         │
 │ skill X  │       │ constants      │      └──────────────────────────────┘
 └──────────┘       └────────────────┘
 suggested complements
```

* Every field is a searchable dropdown, populated from the skill data and filtered by the
  selected hero's weapon / movement restrictions. Refine variants are listed next to their base
  skill and prf skills only appear for the hero who owns them.
* Choosing a hero prefills the slots with that hero's default (base kit) skills.
* The middle panel groups each selected skill's wording into the buckets from the draft:
  `flat modifier`, `buffs`, `debuffs`, `during combat` (buffs / debuffs) and `constants`.
* The right panel accumulates the numbers per stat for **target: ally** (bonuses granted) and
  **target: foe** (penalties inflicted), keeping visible and in-combat values apart, and shows the
  net swing.
* Suggestions rank inherit-able skills for each empty slot against the skills already selected,
  using a small synergy table (`SYNERGY` in `app.js`) — e.g. visible bonuses ↔ stat-scaling
  effects, cooldown acceleration ↔ heavy Specials, damage reduction ↔ sustain.
* The current build is mirrored in the URL hash, so a build can be bookmarked or shared.

## Data

Skill data comes from [`matxx/feh-data`](https://github.com/matxx/feh-data), which is cloned into
the `feh-data/` folder (kept out of Git — the export is ~50 MB). It is far too large and too raw to ship to the browser as
is, so `scripts/build_data.py` pre-computes everything the page needs:

| source | output | contents |
| --- | --- | --- |
| `data/skills.json`, `data/skills-descriptions.json` | `data/skills.json` | 6,200+ skills with category, SP, might, cooldown, restrictions, wording, and a parsed effect breakdown |
| `data/units.json`, `data/skills_units.json` | `data/units.json` | 1,400+ heroes with weapon / move type, default kit and own prf skills |

Rebuild after updating the submodule:

```bash
# first time only — the raw export (~50 MB) is not committed
git clone https://github.com/matxx/feh-data feh-data

python3 scripts/build_data.py                  # writes data/*.json
python3 scripts/build_data.py --source /path/to/feh-data/data   # or point at an existing clone
```

The generated files are committed so GitHub Pages can serve the site without the submodule.

The effect breakdown is heuristic: it reads the English wording clause by clause and classifies
clauses as buffs, debuffs, flat modifiers or constants. It is meant as a readable summary, not a
rules engine — always check the in-game description for exact behaviour.

## Development

It is a static site; no build step is needed for the frontend.

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Files:

* `index.html` — page structure
* `styles.css` — layout and theme
* `app.js` — dropdowns, filtering, effect grouping, accumulation, suggestions
* `scripts/build_data.py` — data pipeline from `feh-data`

Fire Emblem Heroes is © Nintendo / Intelligent Systems. This is an unofficial fan project.
