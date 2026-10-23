/* FEH Skill Synergy Matcher
 * Data is pre-computed by scripts/build_data.py from the matxx/feh-data export.
 * This file only renders state: it never talks to an external service.
 */
'use strict';

/* ------------------------------------------------------------------ */
/* configuration                                                       */
/* ------------------------------------------------------------------ */

// Slots follow the UI draft: weapon, special, A, B, C, seal, X.
const SLOTS = [
  { key: 'weapon', cat: 'weapon', slot: 'Weapon', label: 'weapon' },
  { key: 'special', cat: 'special', slot: 'Special', label: 'special' },
  { key: 'a', cat: 'passivea', slot: 'A', label: 'skill A' },
  { key: 'b', cat: 'passiveb', slot: 'B', label: 'skill B' },
  { key: 'c', cat: 'passivec', slot: 'C', label: 'skill C' },
  { key: 'seal', cat: 'sacredseal', slot: 'Seal', label: 'seal' },
  { key: 'x', cat: 'passivex', slot: 'X', label: 'skill X' },
];

const STATS = ['Atk', 'Spd', 'Def', 'Res'];
const COLORS = ['Red', 'Blue', 'Green', 'Colorless'];

// Modifier tiers, ordered from the most to the least permanent.
const TIERS = [
  { id: 'phantom', label: 'phantom', hint: 'counts for stat checks only' },
  { id: 'flat', label: 'flat', hint: 'always-on stat line change' },
  { id: 'visible', label: 'visible', hint: 'field buff / debuff for a turn' },
  { id: 'combat', label: 'combat', hint: 'only during combat' },
];

const MOVE_TYPES = ['Infantry', 'Armored', 'Cavalry', 'Flying'];

// Display labels per data category, used by the scope note.
const SLOT_BY_CAT = {
  weapon: 'weapon',
  assist: 'assist',
  special: 'special',
  passivea: 'A',
  passiveb: 'B',
  passivec: 'C',
  passivex: 'X',
  sacredseal: 'seal',
};

const WEAPON_GROUPS = [
  { id: 'sword', label: 'sword', match: /Sword/ },
  { id: 'lance', label: 'lance', match: /Lance/ },
  { id: 'axe', label: 'axe', match: /Axe/ },
  { id: 'bow', label: 'bow', match: /Bow/ },
  { id: 'dagger', label: 'dagger', match: /Dagger/ },
  { id: 'tome', label: 'tome', match: /Tome/ },
  { id: 'staff', label: 'staff', match: /Staff/ },
  { id: 'breath', label: 'breath', match: /Breath/ },
  { id: 'beast', label: 'beast', match: /Beast/ },
];

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function signed(n) {
  if (!n) return '—';
  return n > 0 ? `+${n}` : `\u2212${Math.abs(n)}`;
}

function versionLabel(score) {
  if (score === null || score === undefined) return '';
  return `${Math.floor(score / 100)}.${score % 100}`;
}

function spFloor(cat) {
  return data.meta?.spFloors?.[cat] ?? 0;
}

// Top-tier, inheritable skills only. The build already marks each entry, but
// fall back to the policy so a stale data file cannot leak legacy skills.
function isRecommendable(skill) {
  if (typeof skill.recommendable === 'boolean') return skill.recommendable;
  if (skill.exclusive || skill.prf) return false;
  return (skill.sp || 0) >= spFloor(skill.cat);
}

function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/[\u2019']/g, "'");
}

function statKey(key) {
  const parts = key.split('_');
  const stat = parts[parts.length - 1];
  const tier = parts[parts.length - 2];
  const side = parts.length > 2 ? parts[0] : 'ally';
  return { side, tier, stat: stat.charAt(0).toUpperCase() + stat.slice(1) };
}

/* ------------------------------------------------------------------ */
/* data + state                                                        */
/* ------------------------------------------------------------------ */

const data = {
  skills: [],
  units: [],
  meta: { spFloors: {}, floorNotes: {}, rules: {}, pruned: false },
  catalog: { effects: [], targets: [], rules: {}, groups: [], statTierWeights: {} },
  effectById: new Map(),
  skillById: new Map(),
  unitById: new Map(),
  byCat: new Map(),
  effectCounts: new Map(),
  loaded: false,
};

// Skills the user has dismissed ("I do not own this / have no fodder"). They
// survive reloads through localStorage and are filtered out before ranking.
const DISMISS_KEY = 'feh-skill-matcher:dismissed';

function loadDismissed() {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  } catch (error) {
    return new Set();
  }
}

function saveDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...state.dismissed]));
  } catch (error) {
    // Private mode or a full quota: the in-memory set still works this session.
  }
}

const state = {
  unit: null,
  picks: Object.fromEntries(SLOTS.map((slot) => [slot.key, null])),
  filters: { moves: new Set(), weapons: new Set(), effects: new Set() },
  // Weapon type + movement type stand-in for "my unit" when no hero is picked.
  archetype: { weapon: '', move: '' },
  // Legacy / prf skills are hidden from every list unless this is switched on.
  showLegacy: false,
  dismissed: loadDismissed(),
};

const combos = {};

function selectedSkills() {
  return SLOTS.map((slot) => skillFor(slot.key)).filter(Boolean);
}

function skillFor(key) {
  const id = state.picks[key];
  return id ? data.skillById.get(id) || null : null;
}

function effectLabel(id) {
  return data.effectById.get(id)?.label || data.catalog.targets.find((t) => t.id === id)?.label || id;
}

function targetLabel(id) {
  return data.catalog.targets.find((target) => target.id === id)?.label || id;
}

/* ------------------------------------------------------------------ */
/* restrictions + filters                                              */
/* ------------------------------------------------------------------ */

function tokenMatches(token, weaponType) {
  if (!token || !weaponType) return false;
  if (token === weaponType) return true;
  switch (token) {
    case 'All Melee': return /Sword|Lance|Axe/.test(weaponType);
    case 'All Bow': return /Bow/.test(weaponType);
    case 'All Dagger': return /Dagger/.test(weaponType);
    case 'All Tome': return /Tome/.test(weaponType);
    case 'All Breath': return /Breath/.test(weaponType);
    case 'All Beast': return /Beast/.test(weaponType);
    default: break;
  }
  if (COLORS.includes(token)) return weaponType.startsWith(token);
  return false;
}

function tokenMatchesGroup(token, groupId) {
  const group = WEAPON_GROUPS.find((entry) => entry.id === groupId);
  if (!group || !token) return false;
  if (token === 'All Melee') return ['sword', 'lance', 'axe'].includes(groupId);
  return group.match.test(token);
}

function compatible(skill, unit) {
  if (skill.exclusive) return Boolean(unit && unit.prf && unit.prf.includes(skill.id));
  if (!unit) return true;
  const res = skill.res || {};
  const moves = res.moves || {};
  const weapons = res.weapons || {};
  if (moves.can_use && !moves.can_use.includes(unit.mv)) return false;
  if (moves.can_not_use && moves.can_not_use.includes(unit.mv)) return false;
  if (weapons.can_use && !weapons.can_use.some((token) => tokenMatches(token, unit.wt))) return false;
  if (weapons.can_not_use && weapons.can_not_use.some((token) => tokenMatches(token, unit.wt))) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* step 1: strict compatibility / inheritability                      */
/* ------------------------------------------------------------------ */

// Which unit context the candidate pool is built for: a concrete hero, a
// weapon+movement archetype, or "everything" when neither is set.
function unitScope() {
  if (state.unit) return 'hero';
  if (state.archetype.weapon || state.archetype.move) return 'archetype';
  return 'none';
}

function hasArchetype() {
  return unitScope() === 'archetype';
}

// A skill may be *recommended* only when the scoped unit can legally equip it:
// weapon-type restriction, movement-type restriction, and no unit-exclusive
// skill unless the hero actually owns it.
function inheritable(skill) {
  const scope = unitScope();
  if (skill.exclusive) {
    if (scope === 'hero') return Boolean(state.unit.prf && state.unit.prf.includes(skill.id));
    // Browsing only: prf skills belong to some other hero.
    return scope === 'none' ? state.showLegacy : false;
  }
  if (scope === 'hero') return compatible(skill, state.unit);
  if (scope === 'archetype') {
    const { weapon, move } = state.archetype;
    if (weapon && !skillAllowsWeaponGroup(skill, weapon)) return false;
    if (move && !skillAllowsMove(skill, move)) return false;
    return true;
  }
  return true;
}

function skillAllowsMove(skill, move) {
  if (skill.exclusive) return Boolean(state.unit && state.unit.mv === move);
  const res = skill.res?.moves || {};
  if (res.can_use && !res.can_use.includes(move)) return false;
  if (res.can_not_use && res.can_not_use.includes(move)) return false;
  return true;
}

function skillAllowsWeaponGroup(skill, groupId) {
  if (skill.exclusive) {
    return Boolean(state.unit && WEAPON_GROUPS.find((g) => g.id === groupId)?.match.test(state.unit.wt || ''));
  }
  const res = skill.res?.weapons || {};
  if (res.can_use && !res.can_use.some((token) => tokenMatchesGroup(token, groupId))) return false;
  if (res.can_not_use && res.can_not_use.some((token) => tokenMatchesGroup(token, groupId))) return false;
  return true;
}

function hasActiveFilters() {
  const { moves, weapons, effects } = state.filters;
  return Boolean(moves.size || weapons.size || effects.size);
}

function passesFilters(skill) {
  const { moves, weapons, effects } = state.filters;
  if (moves.size && ![...moves].some((move) => skillAllowsMove(skill, move))) return false;
  if (weapons.size && ![...weapons].some((group) => skillAllowsWeaponGroup(skill, group))) return false;
  if (effects.size && ![...effects].some((effect) => skill.named_effects.includes(effect))) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* combobox                                                            */
/* ------------------------------------------------------------------ */

const MAX_VISIBLE_OPTIONS = 60;

function createCombo(root, { placeholder, onChange, ariaLabel }) {
  root.classList.add('combo');
  root.innerHTML = `
    <button type="button" class="combo-field is-empty" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(ariaLabel)}">
      <span class="combo-value"><span class="cv-name">${esc(placeholder)}</span></span>
      <span class="combo-caret" aria-hidden="true">&#9662;</span>
    </button>
    <button type="button" class="combo-clear" aria-label="Clear selection" title="Clear selection">&#215;</button>
    <div class="combo-pop" hidden>
      <input type="search" class="combo-search" placeholder="Search ${esc(placeholder).toLowerCase()}…" autocomplete="off" spellcheck="false">
      <ul class="combo-list" role="listbox" aria-label="${esc(ariaLabel)}"></ul>
      <p class="combo-note"></p>
    </div>`;

  const field = root.querySelector('.combo-field');
  const valueEl = root.querySelector('.combo-value');
  const clearBtn = root.querySelector('.combo-clear');
  const pop = root.querySelector('.combo-pop');
  const search = root.querySelector('.combo-search');
  const list = root.querySelector('.combo-list');
  const note = root.querySelector('.combo-note');

  let options = [];
  let selectedId = null;
  let filtered = [];
  let active = 0;
  let isOpen = false;

  function optionById(id) {
    return options.find((option) => option.id === id) || null;
  }

  function paintSelection() {
    const option = optionById(selectedId);
    root.classList.toggle('has-value', Boolean(option));
    field.classList.toggle('is-empty', !option);
    if (option) {
      const fieldMeta = option.shortMeta !== undefined ? option.shortMeta : option.meta;
      valueEl.innerHTML = `<span class="cv-name">${esc(option.label)}</span>`
        + (fieldMeta ? `<span class="cv-meta">${esc(fieldMeta)}</span>` : '');
    } else {
      valueEl.innerHTML = `<span class="cv-name">${esc(placeholder)}</span>`;
    }
  }

  function applyFilter() {
    const query = normalize(search.value).trim();
    const terms = query ? query.split(/\s+/) : [];
    filtered = terms.length
      ? options.filter((option) => {
        const haystack = normalize(`${option.label} ${option.keywords || ''} ${option.meta || ''}`);
        return terms.every((term) => haystack.includes(term));
      })
      : options.slice();
    active = Math.min(active, Math.max(filtered.length - 1, 0));
    paintList();
  }

  function paintList() {
    if (!filtered.length) {
      list.innerHTML = '<li class="combo-empty">No matching skills for this hero.</li>';
      note.textContent = '';
      return;
    }
    const shown = filtered.slice(0, MAX_VISIBLE_OPTIONS);
    list.innerHTML = shown.map((option, index) => `
      <li class="combo-option ${index === active ? 'is-active' : ''}"
          role="option"
          aria-selected="${option.id === selectedId}"
          data-id="${esc(option.id)}"
          data-index="${index}">
        <span class="co-name">${esc(option.label)}</span>
        <span class="co-meta">${esc(option.meta || '')}</span>
        ${option.note ? `<span class="co-note">${esc(option.note)}</span>` : ''}
      </li>`).join('');
    note.textContent = filtered.length > shown.length
      ? `showing ${shown.length} of ${filtered.length} matches — keep typing to narrow`
      : `${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'}`;
  }

  function moveActive(delta) {
    if (!filtered.length) return;
    const count = Math.min(filtered.length, MAX_VISIBLE_OPTIONS);
    active = (active + delta + count) % count;
    paintList();
    const node = list.querySelector('.combo-option.is-active');
    if (node) node.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    pop.hidden = false;
    root.classList.add('is-open');
    field.setAttribute('aria-expanded', 'true');
    search.value = '';
    const current = options.findIndex((option) => option.id === selectedId);
    active = current >= 0 ? Math.min(current, MAX_VISIBLE_OPTIONS - 1) : 0;
    // Flip above the field when there is no room below (long skill lists).
    const rect = field.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    pop.classList.toggle('is-up', below < 340 && rect.top > below);
    applyFilter();
    search.focus({ preventScroll: true });
    search.select();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    pop.hidden = true;
    root.classList.remove('is-open');
    field.setAttribute('aria-expanded', 'false');
  }

  function choose(id) {
    selectedId = id;
    paintSelection();
    close();
    field.focus({ preventScroll: true });
    onChange(id);
  }

  field.addEventListener('click', () => (isOpen ? close() : open()));

  field.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });

  clearBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (selectedId === null) return;
    selectedId = null;
    paintSelection();
    close();
    onChange(null);
  });

  search.addEventListener('input', () => { active = 0; applyFilter(); });

  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[active];
      if (option) choose(option.id);
    } else if (event.key === 'Escape') { event.preventDefault(); close(); field.focus(); }
    else if (event.key === 'Tab') { close(); }
  });

  list.addEventListener('mousedown', (event) => event.preventDefault());

  list.addEventListener('click', (event) => {
    const node = event.target.closest('.combo-option');
    if (node) choose(node.dataset.id);
  });

  list.addEventListener('mousemove', (event) => {
    const node = event.target.closest('.combo-option');
    if (!node) return;
    const index = Number(node.dataset.index);
    if (index === active) return;
    active = index;
    list.querySelectorAll('.combo-option').forEach((optionNode, i) => optionNode.classList.toggle('is-active', i === index));
  });

  document.addEventListener('click', (event) => {
    if (isOpen && !root.contains(event.target)) close();
  });

  return {
    setOptions(next, { keep = true } = {}) {
      options = next;
      if (keep && selectedId !== null && !optionById(selectedId)) selectedId = null;
      paintSelection();
      if (isOpen) applyFilter();
    },
    setValue(id, { silent = true } = {}) {
      selectedId = id && optionById(id) ? id : null;
      paintSelection();
      if (!silent) onChange(selectedId);
    },
    getValue: () => selectedId,
    close,
  };
}

/* ------------------------------------------------------------------ */
/* rendering: left column                                              */
/* ------------------------------------------------------------------ */

function metaFor(skill) {
  if (skill.slot === 'Weapon') {
    const parts = [];
    if (skill.mt) parts.push(`${skill.mt} mt`);
    if (skill.rng) parts.push(`rng ${skill.rng}`);
    if (skill.sp) parts.push(`${skill.sp} SP`);
    return parts.join(' · ');
  }
  if (skill.slot === 'Special') {
    const parts = [];
    if (skill.cd) parts.push(`cd ${skill.cd}`);
    if (skill.sp) parts.push(`${skill.sp} SP`);
    return parts.join(' · ');
  }
  return skill.sp ? `${skill.sp} SP` : '';
}

// "300 SP · cd 3 · v10.4", skipping empty parts.
function metaLine(skill) {
  return [metaFor(skill), skill.ver ? `v${versionLabel(skill.ver)}` : '']
    .filter(Boolean)
    .join(' · ');
}

function displayName(skill) {
  if (!skill.refine) return skill.name;
  return `${skill.name} · refine ${skill.refine === 'skill1' ? '1' : '2'}`;
}

function badgesFor(skill, unit) {
  const badges = [];
  if (unit && unit.kit && Object.values(unit.kit).includes(skill.id)) badges.push('base kit');
  if (skill.exclusive) badges.push('prf');
  if (skill.refine) badges.push('refine variant');
  if (!skill.exclusive && skill.is_sub_tier) badges.push('prerequisite');
  if (!skill.exclusive && !skill.is_sub_tier && !isRecommendable(skill)) badges.push('legacy tier');
  return badges.join(' · ');
}

// Highest SP first, then newest release, then name — the same ordering the
// recommender uses.
function compareMeta(a, b) {
  return (b.sp || 0) - (a.sp || 0)
    || (b.ver || 0) - (a.ver || 0)
    || a.name.localeCompare(b.name, 'en');
}

function buildOptions(slot) {
  const pool = data.byCat.get(slot.cat) || [];
  // A skill already chosen (or loaded from a hero's kit) must stay selectable
  // even when it is legacy or prf, otherwise the field cannot render it.
  const keepIds = new Set(selectedSkills().map((skill) => skill.id));
  if (state.unit) Object.values(state.unit.kit || {}).forEach((id) => keepIds.add(id));

  return pool
    .filter((skill) => inheritable(skill) && passesFilters(skill))
    .filter((skill) => !isDismissed(skill) || keepIds.has(skill.id))
    .filter((skill) => state.showLegacy || isRecommendable(skill) || keepIds.has(skill.id))
    .sort(compareMeta)
    .map((skill) => ({
      id: skill.id,
      label: displayName(skill),
      meta: metaFor(skill),
      shortMeta: skill.sp ? `${skill.sp} SP` : '',
      note: badgesFor(skill, state.unit),
      keywords: [...skill.named_effects, skill.refine ? 'refine' : ''].join(' '),
    }));
}

function buildCharacterOptions() {
  return data.units.map((unit) => ({
    id: unit.id,
    label: unit.name,
    meta: [unit.wt, unit.mv].filter(Boolean).join(' · '),
    shortMeta: unit.mv || '',
    keywords: [unit.wt, unit.mv, `book ${unit.book || ''}`].join(' '),
  }));
}

function renderSlots() {
  $('slots').innerHTML = SLOTS.map((slot) => `
    <div class="slot-row">
      <span class="slot-key" data-slot="${slot.key}" data-filled="false">${esc(slot.label)}</span>
      <div id="combo-${slot.key}"></div>
    </div>`).join('');

  for (const slot of SLOTS) {
    combos[slot.key] = createCombo($(`combo-${slot.key}`), {
      placeholder: `select ${slot.label}…`,
      ariaLabel: `${slot.label} skill`,
      onChange: (id) => {
        state.picks[slot.key] = id;
        refresh();
      },
    });
    combos[slot.key].setOptions(buildOptions(slot));
    combos[slot.key].setValue(state.picks[slot.key]);
  }
}

function syncSlotOptions() {
  for (const slot of SLOTS) {
    combos[slot.key].setOptions(buildOptions(slot));
    combos[slot.key].setValue(state.picks[slot.key]);
  }
}

function renderCharacter() {
  const unit = state.unit;
  const meta = $('character-meta');
  if (!unit) {
    if (hasArchetype()) {
      const weapon = WEAPON_GROUPS.find((group) => group.id === state.archetype.weapon);
      const tags = [
        weapon ? `<span class="tag tag--accent">${esc(weapon.label)} archetype</span>` : '',
        state.archetype.move ? `<span class="tag tag--accent">${esc(state.archetype.move)}</span>` : '',
        '<span class="tag">no hero — inheritable sets shown</span>',
      ].filter(Boolean).join('');
      meta.innerHTML = tags;
      return;
    }
    meta.innerHTML = '<span class="tag">no hero selected — every compatible skill is listed</span>';
    return;
  }
  const kitCount = Object.keys(unit.kit || {}).length;
  meta.innerHTML = [
    unit.wt ? `<span class="tag">${esc(unit.wt)}</span>` : '',
    unit.mv ? `<span class="tag">${esc(unit.mv)}</span>` : '',
    unit.ver ? `<span class="tag">v${esc(unit.ver)}</span>` : '',
    kitCount ? `<span class="tag tag--accent">${kitCount} default skills loaded</span>` : '',
  ].join('');
}

/* ------------------------------------------------------------------ */
/* rendering: filters                                                 */
/* ------------------------------------------------------------------ */

function chipGroup(label, items, activeSet, kind) {
  return `
    <div class="filter-group">
      <h3>${esc(label)}</h3>
      <div class="filter-chips">
        ${items.map((item) => `
          <label class="chip ${activeSet.has(item.id) ? 'is-on' : ''}">
            <input type="checkbox" data-filter="${kind}" value="${esc(item.id)}" ${activeSet.has(item.id) ? 'checked' : ''}>
            <span>${esc(item.label)}</span>
          </label>`).join('')}
      </div>
    </div>`;
}

function renderFilters() {
  const { moves, weapons, effects } = state.filters;
  const effectItems = [...data.catalog.effects]
    .filter((effect) => (data.effectCounts.get(effect.id) || 0) > 0)
    .sort((a, b) => (data.effectCounts.get(b.id) || 0) - (data.effectCounts.get(a.id) || 0)
      || a.label.localeCompare(b.label, 'en'))
    .map((effect) => ({ id: effect.id, label: `${effect.label} (${data.effectCounts.get(effect.id)})` }));

  const floors = data.meta?.spFloors || {};
  const floorList = Object.entries(floors)
    .filter(([cat, value]) => value > 0 && SLOT_BY_CAT[cat])
    .map(([cat, value]) => `${SLOT_BY_CAT[cat]} ${value}+`)
    .join(' · ');

  const archetypeSelect = (kind, label, items) => `
    <label class="archetype-field">
      <span>${esc(label)}</span>
      <select data-archetype="${kind}" aria-label="archetype ${esc(label)}">
        <option value="" ${state.archetype[kind] ? '' : 'selected'}>any</option>
        ${items.map((item) => `<option value="${esc(item.id)}" ${state.archetype[kind] === item.id ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}
      </select>
    </label>`;

  $('filters').innerHTML = [
    `<div class="filter-group">
       <h3>unit archetype</h3>
       <div class="archetype-grid">
         ${archetypeSelect('weapon', 'weapon', WEAPON_GROUPS)}
         ${archetypeSelect('move', 'movement', MOVE_TYPES.map((move) => ({ id: move, label: move })))}
       </div>
       <p class="filter-scope-note">
         With no hero selected, these two fields stand in for the unit: only skills this
         weapon + movement can inherit are scored${state.unit ? ' (a selected hero overrides them)' : ''}.
       </p>
     </div>`,
    chipGroup('movement', MOVE_TYPES.map((move) => ({ id: move, label: move })), moves, 'moves'),
    chipGroup('weapon', WEAPON_GROUPS.map((group) => ({ id: group.id, label: group.label })), weapons, 'weapons'),
    chipGroup('grants named effect', effectItems, effects, 'effects'),
    `<div class="filter-group">
       <h3>list scope</h3>
       <div class="filter-chips">
         <label class="chip chip--toggle ${state.showLegacy ? 'is-on' : ''}">
           <input type="checkbox" data-toggle="showLegacy" ${state.showLegacy ? 'checked' : ''}>
           <span>include prf &amp; off-meta</span>
         </label>
       </div>
       <p class="filter-scope-note">
         Lists are limited to top-tier inheritables — no prf, no prerequisites, and
         ${esc(floorList)} SP by slot. The switch also reveals unit-exclusive skills and the
         legacy skills a hero already ships with; suggestions stay top-tier either way.
       </p>
     </div>`,
  ].join('');

  updateFilterStatus();
}

function updateFilterStatus() {
  const count = activeFilterCount();
  const scope = state.showLegacy ? 'off-meta' : 'top-tier';
  $('filter-note').textContent = count ? `${count} active · ${scope}` : scope;
  $('filter-clear').disabled = count === 0;
  $('filters').classList.toggle('has-active', count > 0);
}

function activeFilterCount() {
  const { moves, weapons, effects } = state.filters;
  return moves.size + weapons.size + effects.size;
}

function bindFilterEvents() {
  $('filters').addEventListener('change', (event) => {
    const toggle = event.target.closest('input[data-toggle]');
    if (toggle) {
      state[toggle.dataset.toggle] = toggle.checked;
      toggle.closest('.chip')?.classList.toggle('is-on', toggle.checked);
      updateFilterStatus();
      syncSlotOptions();
      refresh();
      return;
    }
    const select = event.target.closest('select[data-archetype]');
    if (select) {
      state.archetype[select.dataset.archetype] = select.value;
      // A hero and an archetype are two ways of answering the same question;
      // picking an archetype drops the hero so the scopes cannot disagree.
      if (state.unit) applyUnit(null);
      syncSlotOptions();
      refresh();
      return;
    }

    const input = event.target.closest('input[data-filter]');
    if (!input) return;
    const set = state.filters[input.dataset.filter];
    if (input.checked) set.add(input.value);
    else set.delete(input.value);
    input.closest('.chip')?.classList.toggle('is-on', input.checked);
    updateFilterStatus();
    syncSlotOptions();
    refresh();
  });

  $('filter-clear').addEventListener('click', () => {
    Object.values(state.filters).forEach((set) => set.clear());
    renderFilters();
    syncSlotOptions();
    refresh();
  });
}

/* ------------------------------------------------------------------ */
/* rendering: effect breakdown                                         */
/* ------------------------------------------------------------------ */

const CLAUSE_GROUPS = [
  { kind: 'buff', tier: 'visible', title: 'field buffs' },
  { kind: 'debuff', tier: 'visible', title: 'field debuffs' },
  { kind: 'buff', tier: 'flat', title: 'flat stat changes' },
  { kind: 'debuff', tier: 'flat', title: 'flat stat drops' },
  { kind: 'buff', tier: 'phantom', title: 'phantom stats' },
  { kind: 'flat', tier: 'phantom', title: 'phantom / stat-check modifiers' },
  { kind: 'buff', tier: 'combat', title: 'during combat · buffs' },
  { kind: 'debuff', tier: 'combat', title: 'during combat · debuffs' },
  { kind: 'flat', tier: 'combat', title: 'during combat · flat modifiers' },
  { kind: 'const', tier: 'combat', title: 'during combat · constants' },
  { kind: 'flat', tier: 'visible', title: 'flat modifiers' },
  { kind: 'const', tier: 'flat', title: 'constants' },
  { kind: 'other', tier: null, title: 'other effects' },
];

function collectClauses() {
  const buckets = new Map();
  for (const slot of SLOTS) {
    const skill = skillFor(slot.key);
    if (!skill) continue;
    for (const [kind, target, tier, text] of skill.clauses || []) {
      const key = `${kind}:${kind === 'other' ? '' : tier}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ skill, target, text });
    }
  }
  return buckets;
}

function collectNamedEffects() {
  const byId = new Map();
  for (const slot of SLOTS) {
    const skill = skillFor(slot.key);
    if (!skill) continue;
    for (const effect of skill.named_effects) {
      if (!byId.has(effect)) byId.set(effect, []);
      byId.get(effect).push(skill.name);
    }
  }
  return byId;
}

function fxList(items) {
  return `<ul class="fx-list">${items.map((item) => `
    <li data-target="${esc(item.target)}">
      <span class="fx-src">${esc(item.skill.name)}</span>
      <span class="fx-text">${esc(item.text)}</span>
    </li>`).join('')}</ul>`;
}

function fxGroup(title, items, modifier = '') {
  if (!items.length) return '';
  return `
    <div class="fx-group ${modifier}">
      <h3>${esc(title)} <span class="count">${items.length}</span></h3>
      ${fxList(items)}
    </div>`;
}

function renderNamedEffects(byId) {
  const groups = new Map(data.catalog.groups.map((group) => [group.id, []]));
  for (const [effect, sources] of byId) {
    const meta = data.effectById.get(effect);
    if (!meta) continue;
    if (!groups.has(meta.group)) groups.set(meta.group, []);
    groups.get(meta.group).push({ meta, sources });
  }
  const blocks = [];
  for (const [groupId, entries] of groups) {
    if (!entries.length) continue;
    const groupLabel = data.catalog.groups.find((group) => group.id === groupId)?.label || groupId;
    blocks.push(`
      <div class="named-group">
        <h4>${esc(groupLabel)}</h4>
        <ul class="named-list">
          ${entries.sort((a, b) => a.meta.label.localeCompare(b.meta.label, 'en')).map(({ meta, sources }) => `
            <li>
              <span class="named-chip" title="${esc(meta.desc)}">${esc(meta.label)}</span>
              <span class="named-src">${esc([...new Set(sources)].join(', '))}</span>
            </li>`).join('')}
        </ul>
      </div>`);
  }
  return blocks.join('');
}

function renderEffects() {
  const host = $('effects');
  const chosen = selectedSkills();
  if (!chosen.length) {
    $('effect-note').textContent = '';
    host.innerHTML = '<p class="empty-note">Select a <strong>weapon</strong>, <strong>special</strong> or passive to see its named effects and the wording split into field, flat and in-combat modifiers.</p>';
    return;
  }

  const buckets = collectClauses();
  const named = collectNamedEffects();
  const totalClauses = [...buckets.values()].reduce((sum, list) => sum + list.length, 0);
  $('effect-note').textContent = `${chosen.length} skill${chosen.length === 1 ? '' : 's'} · ${named.size} named effect${named.size === 1 ? '' : 's'} · ${totalClauses} clauses`;

  const clauseHtml = CLAUSE_GROUPS.map((group) => {
    const key = `${group.kind}:${group.tier ?? ''}`;
    return fxGroup(group.title, buckets.get(key) || [], group.tier === 'combat' ? 'fx-group--combat' : '');
  }).join('');

  host.innerHTML = `
    ${named.size ? `<div class="fx-group"><h3>named effects <span class="count">${named.size}</span></h3>${renderNamedEffects(named)}</div>` : ''}
    ${clauseHtml || '<p class="empty-note">These skills carry no parsed effect lines — open their in-game description for exact wording.</p>'}`;
}

/* ------------------------------------------------------------------ */
/* rendering: accumulated constants                                    */
/* ------------------------------------------------------------------ */

function accumulate() {
  // { ally: { stat: { tier: value } }, foe: { stat: { tier: value } } }
  const totals = { ally: {}, foe: {} };
  for (const side of ['ally', 'foe']) {
    for (const stat of STATS) totals[side][stat] = {};
  }
  for (const skill of selectedSkills()) {
    for (const [key, value] of Object.entries(skill.flat_modifiers || {})) {
      const { side, tier, stat } = statKey(key);
      if (!totals[side][stat]) totals[side][stat] = {};
      totals[side][stat][tier] = (totals[side][stat][tier] || 0) + value;
    }
  }
  return totals;
}

function tierBreakdown(byTier) {
  return TIERS
    .filter((tier) => byTier[tier.id])
    .map((tier) => `<span class="tier-chip tier-chip--${tier.id}" title="${esc(tier.hint)}">${signed(byTier[tier.id])} ${tier.label}</span>`)
    .join('');
}

function tierTotal(byTier) {
  return Object.values(byTier).reduce((sum, value) => sum + value, 0);
}

function renderConstants() {
  const totals = accumulate();
  const host = $('targets');
  const chosen = selectedSkills();
  const totalSP = chosen.reduce((sum, skill) => sum + (skill.sp || 0), 0);
  $('sp-note').textContent = chosen.length ? `${chosen.length}/${SLOTS.length} slots · ${totalSP} SP` : `${SLOTS.length} slots`;

  host.innerHTML = `
    <div class="targets-head">
      <span></span>
      <span class="th-ally">target: ally</span>
      <span class="th-foe">target: foe</span>
    </div>
    ${STATS.map((stat) => {
      const allyTiers = totals.ally[stat] || {};
      const foeTiers = totals.foe[stat] || {};
      const allyTotal = tierTotal(allyTiers);
      const foeTotal = tierTotal(foeTiers);
      return `
        <div class="stat-cell stat-name">${stat}</div>
        <div class="stat-cell value ${allyTotal > 0 ? 'is-positive' : allyTotal < 0 ? 'is-negative' : 'is-zero'}">
          <span class="stat-total">${signed(allyTotal)}</span>
          <span class="tier-stack">${tierBreakdown(allyTiers)}</span>
        </div>
        <div class="stat-cell value ${foeTotal < 0 ? 'is-negative' : foeTotal > 0 ? 'is-positive' : 'is-zero'}">
          <span class="stat-total">${signed(foeTotal)}</span>
          <span class="tier-stack">${tierBreakdown(foeTiers)}</span>
        </div>`;
    }).join('')}`;

  const net = STATS
    .map((stat) => ({
      stat,
      swing: tierTotal(totals.ally[stat] || {}) - tierTotal(totals.foe[stat] || {}),
    }))
    .filter((row) => row.swing > 0)
    .map((row) => `<span class="net-chip">${row.stat} ${signed(row.swing)} swing</span>`)
    .join('');

  $('net-row').innerHTML = net || '<span class="panel-note">No stat bonuses or penalties in this kit yet.</span>';

  const hasAny = STATS.some((stat) => tierTotal(totals.ally[stat] || {}) || tierTotal(totals.foe[stat] || {}));
  $('const-note').innerHTML = hasAny
    ? 'Each cell splits into <span class="tier-chip tier-chip--phantom">phantom</span> '
      + '<span class="tier-chip tier-chip--flat">flat</span> '
      + '<span class="tier-chip tier-chip--visible">visible</span> '
      + '<span class="tier-chip tier-chip--combat">combat</span>. Foe figures are what the skill does to the opponent&rsquo;s stat line.'
    : 'Field buffs, flat stat changes and in-combat modifiers are tracked separately, then summed per target.';
}

/* ------------------------------------------------------------------ */
/* rendering: suggestions (synergy engine)                            */
/* ------------------------------------------------------------------ */

function modifiersFor(skill, side, stat) {
  const result = {};
  for (const [key, value] of Object.entries(skill.flat_modifiers || {})) {
    const parts = statKey(key);
    if (parts.side !== side || parts.stat !== stat) continue;
    if (value > 0) result[parts.tier] = (result[parts.tier] || 0) + value;
  }
  return result;
}

// Provider effects that only make sense when the stat they raise is the stat
// the other skill actually checks — those are scored by statReasons().
const STAT_PROVIDERS = new Set([
  'phantom_stat', 'flat_stat_boost', 'visible_buff_grant',
  'combat_stat_boost', 'visible_debuff_apply', 'combat_stat_debuff',
]);
// Targets scored through the stat line rather than through named effects.
const STAT_TARGETS = new Set(['stat_comparison']);

function effectReasons(candidate, anchors) {
  const reasons = [];
  // Forward: the selected skill needs something, the candidate supplies it.
  for (const anchor of anchors) {
    for (const target of anchor.synergy_targets || []) {
      if (STAT_TARGETS.has(target)) continue;
      for (const rule of data.catalog.rules[target] || []) {
        if (STAT_PROVIDERS.has(rule.provider)) continue;
        if (!candidate.named_effects.includes(rule.provider)) continue;
        reasons.push({
          weight: rule.weight,
          html: `<b>${esc(effectLabel(rule.provider))}</b> — ${esc(rule.rationale)} <span class="why-src">(${esc(anchor.name)})</span>`,
        });
      }
    }
  }
  // Reverse: the candidate needs something the build already brings.
  for (const target of candidate.synergy_targets || []) {
    if (STAT_TARGETS.has(target)) continue;
    // A skill that already brings the thing it needs does not need a partner.
    if (candidate.named_effects.includes(target)) continue;
    for (const rule of data.catalog.rules[target] || []) {
      if (STAT_PROVIDERS.has(rule.provider)) continue;
      if (candidate.named_effects.includes(rule.provider)) continue;
      const anchor = anchors.find((entry) => entry.named_effects.includes(rule.provider));
      if (!anchor) continue;
      reasons.push({
        weight: rule.weight * 0.85,
        html: `<b>needs ${esc(targetLabel(target))}</b> — ${esc(anchor.name)} already brings ${esc(effectLabel(rule.provider))}`,
      });
    }
  }
  return reasons;
}

function statReasonHtml(side, stat, anchorName, value, tier) {
  const label = tier === 'phantom' ? `Phantom ${stat} ${signed(value)}` : `${signed(value)} ${tier} ${stat}`;
  const verb = tier === 'phantom' ? 'wins' : 'clears';
  return {
    weight: 0,
    label,
    html: side === 'forward'
      ? `<b>${esc(label)}</b> — ${verb} ${esc(anchorName)}'s ${stat} check`
      : `<b>needs ${stat} for its check</b> — ${esc(anchorName)} brings ${esc(label)}`,
  };
}

function statReasons(candidate, anchors) {
  const reasons = [];
  const weights = data.catalog.statTierWeights || {};
  const scored = (tiers, value) => (weights[tiers] || 0) * Math.min(value, 7) / 7 * 2.5;

  for (const anchor of anchors) {
    // forward: the candidate raises the stat the selected skill checks
    for (const stat of anchor.check_stats || []) {
      for (const [tier, value] of Object.entries(modifiersFor(candidate, 'ally', stat))) {
        const weight = scored(tier, value);
        if (weight <= 0) continue;
        reasons.push({ ...statReasonHtml('forward', stat, anchor.name, value, tier), weight });
      }
    }
    // reverse: the candidate checks a stat the build already raises
    for (const stat of candidate.check_stats || []) {
      for (const [tier, value] of Object.entries(modifiersFor(anchor, 'ally', stat))) {
        if (tier === 'combat') continue; // the candidate's check happens before combat
        const weight = scored(tier, value) * 0.85;
        if (weight <= 0) continue;
        reasons.push({ ...statReasonHtml('reverse', stat, anchor.name, value, tier), weight });
      }
    }
  }
  return reasons;
}

/* ------------------------------------------------------------------ */
/* step 2: max-condition output score                                 */
/* ------------------------------------------------------------------ */

const outputCache = new Map();

// data/skills.json stores `output` as { ally|foe: { atk: {visible,flat,combat} },
// true_damage: {flat, pct:[{stat,value}]}, dr }. Normalise the stat casing once.
function normaliseOutput(skill) {
  const cached = outputCache.get(skill.id);
  if (cached) return cached;

  const raw = skill.output || {};
  const out = { ally: {}, foe: {}, trueFlat: 0, truePct: [], dr: raw.dr || 0 };
  for (const side of ['ally', 'foe']) {
    for (const [stat, tiers] of Object.entries(raw[side] || {})) {
      const name = stat.charAt(0).toUpperCase() + stat.slice(1);
      const clean = {};
      for (const [tier, value] of Object.entries(tiers)) {
        if (value) clean[tier] = value;
      }
      if (Object.keys(clean).length) out[side][name] = clean;
    }
  }
  const damage = raw.true_damage || {};
  out.trueFlat = damage.flat || 0;
  out.truePct = damage.pct || [];
  outputCache.set(skill.id, out);
  return out;
}

// Field buffs do not stack: two sources granting Atk+6 still give +6. Only the
// strongest source already in the build counts, so a second one is not scored
// twice. In-combat boosts and true damage do stack and are summed.
function kitBaseline(anchors) {
  const ally = {};
  const foe = {};
  for (const skill of anchors) {
    const out = normaliseOutput(skill);
    for (const [stat, tiers] of Object.entries(out.ally)) {
      if (tiers.visible > 0) ally[stat] = Math.max(ally[stat] || 0, tiers.visible);
    }
    for (const [stat, tiers] of Object.entries(out.foe)) {
      if (tiers.visible < 0) foe[stat] = Math.min(foe[stat] || 0, tiers.visible);
    }
  }
  return { ally, foe };
}

function scoringPolicy() {
  const scoring = data.meta?.scoring || {};
  return {
    statWeights: scoring.statWeights || { Atk: 1, Spd: 1, Def: 1, Res: 1 },
    foeWeight: scoring.foeWeight ?? 0.9,
    trueWeight: scoring.trueDamageWeight ?? 1,
    drWeight: scoring.damageReductionWeight ?? 0.2,
    maxDR: scoring.maxDamageReduction ?? 80,
    baselines: scoring.percentBaselines || { Atk: 60, Spd: 50, Def: 45, Res: 40 },
  };
}

// Value of a candidate for the scoped unit with every condition active, minus
// whatever the current build already provides.
function scoreOutput(skill, base) {
  const policy = scoringPolicy();
  const out = normaliseOutput(skill);
  const parts = { ally: {}, foe: {}, trueFlat: 0, truePct: [], dr: 0 };
  let score = 0;

  for (const stat of STATS) {
    const weight = policy.statWeights[stat] ?? 1;

    const tiers = out.ally[stat] || {};
    const covered = Math.max(0, base.ally[stat] || 0);
    const visible = Math.max(0, (tiers.visible || 0) - covered);
    const value = (tiers.flat || 0) + (tiers.combat || 0) + visible;
    if (value) {
      parts.ally[stat] = value;
      score += value * weight;
    }

    const foeTiers = out.foe[stat] || {};
    const applied = Math.max(0, -(base.foe[stat] || 0));
    const foeValue = Math.max(0, -(foeTiers.visible || 0) - applied)
      + Math.max(0, -(foeTiers.combat || 0));
    if (foeValue) {
      parts.foe[stat] = foeValue;
      score += foeValue * weight * policy.foeWeight;
    }
  }

  if (out.trueFlat) {
    parts.trueFlat = out.trueFlat;
    score += out.trueFlat * policy.trueWeight;
  }
  for (const entry of out.truePct) {
    const stats = entry.stats || [entry.stat];
    const baseline = Math.max(...stats.map((stat) => policy.baselines[stat] ?? 50));
    const points = (entry.value / 100) * baseline;
    if (!points) continue;
    parts.truePct.push({ ...entry, stats, points });
    score += points * policy.trueWeight;
  }

  const dr = Math.min(out.dr || 0, policy.maxDR);
  if (dr) {
    parts.dr = dr;
    score += dr * policy.drWeight;
  }

  return { score: Math.round(score * 10) / 10, parts };
}

// "+15 Atk/Spd", "−7 Spd/Res on foe", "+5 true damage", "30% DR".
function outputSummary(parts) {
  const groups = (values) => {
    const byValue = new Map();
    for (const stat of STATS) {
      const value = values[stat];
      if (!value) continue;
      if (!byValue.has(value)) byValue.set(value, []);
      byValue.get(value).push(stat);
    }
    return [...byValue].map(([value, stats]) => `${signed(value)} ${stats.join('/')}`);
  };

  const bits = [...groups(parts.ally)];
  const foe = groups(parts.foe);
  if (foe.length) bits.push(`${foe.join(' · ')} on foe`);
  if (parts.trueFlat) bits.push(`${signed(parts.trueFlat)} true damage`);
  for (const entry of parts.truePct) {
    const stats = entry.stats || [entry.stat];
    bits.push(`${entry.value}% ${stats.join('/')} bonus damage`);
  }
  if (parts.dr) bits.push(`${parts.dr}% DR`);
  return bits.join(' · ');
}

function outputLine(skill, scored) {
  const summary = outputSummary(scored.parts);
  if (!summary) {
    return `<span class="si-scorerow">
      <span class="si-score si-score--zero">0.0</span>
      <span class="si-output">utility only — no flat stats or damage</span>
    </span>`;
  }
  return `<span class="si-scorerow">
      <span class="si-score" title="max-condition output score — every condition treated as active">${scored.score.toFixed(1)}</span>
      <span class="si-output"><b>estimated max output</b> ${esc(summary)}</span>
    </span>`;
}

// Step 1 filter + step 2 score, then rank by output.
function rankCandidates(slot, anchors) {
  const taken = new Set(selectedSkills().map((skill) => skill.id));
  const pool = (data.byCat.get(slot.cat) || []).filter((skill) => (
    isRecommendable(skill)                       // no prf, no prerequisite, SP floor
    && inheritable(skill)                        // weapon / movement / ownership
    && !taken.has(skill.id)                      // never offer a skill already equipped
    && !isDismissed(skill)                       // hidden by the user
    && passesFilters(skill)
  ));

  const base = kitBaseline(anchors);
  const covered = new Set();
  for (const anchor of anchors) for (const effect of anchor.named_effects) covered.add(effect);

  const ranked = [];
  for (const skill of pool) {
    const scored = scoreOutput(skill, base);
    // With a build loaded the card must still explain itself, so synergy stays
    // a requirement; the archetype-only view simply ranks by raw output.
    const reasons = anchors.length
      ? [...effectReasons(skill, anchors), ...statReasons(skill, anchors)]
      : [];
    if (anchors.length && !reasons.length) continue;
    if (scored.score <= 0 && !reasons.length) continue;
    ranked.push({ skill, reasons, ...scored });
  }

  // Highest non-redundant output first; ties fall back to the meta order.
  ranked.sort((a, b) => b.score - a.score
    || (b.skill.sp || 0) - (a.skill.sp || 0)
    || (b.skill.ver || 0) - (a.skill.ver || 0)
    || a.skill.name.localeCompare(b.skill.name, 'en'));

  return ranked.slice(0, 5);
}

function reasonList(reasons) {
  const seen = new Set();
  const unique = reasons
    .sort((a, b) => b.weight - a.weight)
    .filter((reason) => {
      if (seen.has(reason.html)) return false;
      seen.add(reason.html);
      return true;
    });
  const shown = unique.slice(0, 2).map((reason) => reason.html).join('<br>');
  const rest = unique.length > 2 ? ` <span class="why-more">+${unique.length - 2} more</span>` : '';
  return shown + rest;
}

function effectChips(skill, limit = 3) {
  const chips = skill.named_effects.slice(0, limit).map((effect) => (
    `<span class="mini-chip">${esc(effectLabel(effect))}</span>`
  ));
  if (skill.named_effects.length > limit) {
    chips.push(`<span class="mini-chip mini-chip--muted">+${skill.named_effects.length - limit}</span>`);
  }
  return chips.join('');
}

/* ------------------------------------------------------------------ */
/* dismissed skills                                                    */
/* ------------------------------------------------------------------ */

function isDismissed(skill) {
  return Boolean(skill) && state.dismissed.has(skill.id);
}

function dismissSkill(id) {
  if (!id || state.dismissed.has(id)) return;
  state.dismissed.add(id);
  saveDismissed();
  // The slot dropdowns hold their own option list, so they need a resync.
  if (combos.weapon) syncSlotOptions();
  refresh();
}

function restoreDismissed() {
  if (!state.dismissed.size) return;
  state.dismissed.clear();
  saveDismissed();
  if (combos.weapon) syncSlotOptions();
  refresh();
}

// "3 skills dismissed — Agnea's Arrow, Flare, …" so the bar is not anonymous.
function dismissedTitle() {
  const names = [...state.dismissed]
    .map((id) => data.skillById.get(id)?.name)
    .filter(Boolean);
  if (!names.length) return 'Dismissed skills are hidden from recommendations.';
  const shown = names.slice(0, 12).join(', ');
  return `${shown}${names.length > 12 ? ` and ${names.length - 12} more` : ''}`;
}

function renderDismissBar() {
  const bar = $('dismiss-bar');
  if (!bar) return;
  const count = state.dismissed.size;
  bar.hidden = count === 0;
  if (!count) return;
  $('dismiss-count').textContent = `${count} skill${count === 1 ? '' : 's'} dismissed`;
  $('dismiss-count').title = dismissedTitle();
  $('dismiss-restore').textContent = count === 1 ? 'Restore dismissed skill' : 'Restore dismissed skills';
}

function renderSuggestions() {
  const host = $('suggestions');
  const anchors = selectedSkills();
  const emptySlots = SLOTS.filter((slot) => !state.picks[slot.key]);
  const note = $('suggest-note');

  if (!anchors.length && !hasArchetype()) {
    note.textContent = '';
    host.innerHTML = '<p class="empty-note">Select a hero — or set a weapon + movement archetype in the filters — to score every skill that unit can inherit.</p>';
    return;
  }

  if (!emptySlots.length) {
    note.textContent = 'all slots filled';
    host.innerHTML = `<p class="empty-note">
      Every slot is filled. Swap any skill in the set — <strong>${esc(anchors.length)} skills, ${anchors.reduce((n, skill) => n + (skill.sp || 0), 0)} SP</strong> —
      and the breakdown updates instantly.</p>`;
    return;
  }

  const blocks = [];
  const barren = [];
  let emptyBecauseFilters = false;
  for (const slot of emptySlots) {
    const ranked = rankCandidates(slot, anchors);
    if (!ranked.length) {
      if (hasActiveFilters()) emptyBecauseFilters = true;
      barren.push(slot.label);
      continue;
    }
    blocks.push(`
      <div class="suggest-block">
        <h3>${esc(slot.label)} <span class="pill pill--empty">empty</span></h3>
        <ul class="suggest-list">
          ${ranked.map(({ skill, reasons, score, parts }) => `
            <li>
              <div class="suggest-item" role="button" tabindex="0"
                   data-slot="${esc(slot.key)}" data-id="${esc(skill.id)}"
                   aria-label="Add ${esc(skill.name)} to ${esc(slot.label)}">
                <span class="si-top">
                  <span class="si-name">${esc(skill.name)}</span>
                  <span class="si-right">
                    <span class="si-meta">${esc(metaLine(skill))}</span>
                    <button type="button" class="dismiss-btn" data-dismiss="${esc(skill.id)}"
                            title="Dismiss — hide this skill from recommendations"
                            aria-label="Dismiss ${esc(skill.name)}">&#10005;</button>
                  </span>
                </span>
                ${outputLine(skill, { score, parts })}
                ${reasons.length ? `<span class="si-why">${reasonList(reasons)}</span>` : ''}
                <span class="si-effects">${effectChips(skill)}</span>
              </div>
            </li>`).join('')}
        </ul>
      </div>`);
  }

  const scope = state.unit
    ? 'this hero'
    : hasArchetype() ? 'this archetype' : 'any unit';
  note.textContent = blocks.length
    ? `top-tier inheritable · ${scope} · ranked by max output${anchors.length ? ` · ${anchors.length} selected skill${anchors.length === 1 ? '' : 's'}` : ''}${hasActiveFilters() ? ' · filters on' : ''}`
    : '';

  const barrenNote = blocks.length && barren.length
    ? `<p class="empty-note barren-note">No direct synergy found for ${barren.length === 1 ? '' : 'the '}${esc(barren.join(', '))} slot${barren.length === 1 ? '' : 's'} — pick from the full list, or add another skill to widen the search.${state.dismissed.size ? ' Dismissed skills stay hidden until you restore them.' : ''}</p>`
    : '';

  host.innerHTML = (blocks.join('') + barrenNote) || `<p class="empty-note">${emptyBecauseFilters
    ? 'No candidate skill matches the active filters. <button type="button" class="link-button" data-clear-filters>Clear filters</button> to widen the list.'
    : `No obvious complements for the remaining slots yet. Add one more skill, or pick a slot manually — the list is limited to skills this hero can actually inherit.`}</p>`;
}

/* ------------------------------------------------------------------ */
/* state plumbing                                                      */
/* ------------------------------------------------------------------ */

function refresh({ syncOptions = false } = {}) {
  if (syncOptions) syncSlotOptions();
  for (const slot of SLOTS) {
    const key = document.querySelector(`.slot-key[data-slot="${slot.key}"]`);
    if (key) key.dataset.filled = String(Boolean(state.picks[slot.key]));
  }
  renderCharacter();
  renderEffects();
  renderConstants();
  renderDismissBar();
  renderSuggestions();
  $('kit-note').textContent = state.unit
    ? (Object.keys(state.unit.kit || {}).length ? 'default kit prefilled' : 'no default kit data')
    : '';
  writeHash();
}

function applyUnit(unitId) {
  state.unit = unitId ? data.unitById.get(unitId) || null : null;
  // A hero is a more specific answer than an archetype; drop the archetype so
  // clearing the hero later cannot silently switch the scope back.
  if (state.unit) state.archetype = { weapon: '', move: '' };
  const kit = state.unit?.kit || {};
  for (const slot of SLOTS) {
    const baseId = kit[slot.cat];
    const skill = baseId ? data.skillById.get(baseId) : null;
    state.picks[slot.key] = skill && compatible(skill, state.unit) ? skill.id : null;
  }
  combos.character.setValue(state.unit?.id || null);
  // Selecting a hero clears the archetype fields; repaint them so the panel
  // matches the scope that is actually in force.
  if (state.unit) renderFilters();
  syncSlotOptions();
  refresh();
}

/* ------------------------------------------------------------------ */
/* url hash                                                            */
/* ------------------------------------------------------------------ */

function writeHash() {
  const params = new URLSearchParams();
  if (state.unit) params.set('unit', state.unit.id);
  if (!state.unit) {
    if (state.archetype.weapon) params.set('wt', state.archetype.weapon);
    if (state.archetype.move) params.set('mv', state.archetype.move);
  }
  for (const slot of SLOTS) {
    if (state.picks[slot.key]) params.set(slot.key, state.picks[slot.key]);
  }
  const next = params.toString();
  history.replaceState(null, '', next ? `#${next}` : `${location.pathname}${location.search}`);
}

function readHash() {
  if (!location.hash || location.hash.length < 2) return false;
  const params = new URLSearchParams(location.hash.slice(1));
  const unitId = params.get('unit');
  state.unit = unitId ? data.unitById.get(unitId) || null : null;
  state.archetype = {
    weapon: state.unit ? '' : (params.get('wt') || ''),
    move: state.unit ? '' : (params.get('mv') || ''),
  };
  for (const slot of SLOTS) {
    const id = params.get(slot.key);
    const skill = id ? data.skillById.get(id) : null;
    if (skill) {
      state.picks[slot.key] = compatible(skill, state.unit) ? skill.id : null;
    } else if (!params.has(slot.key) && state.unit) {
      // Slots missing from the hash fall back to the hero's default kit.
      const kitSkill = state.unit.kit?.[slot.cat]
        ? data.skillById.get(state.unit.kit[slot.cat])
        : null;
      state.picks[slot.key] = kitSkill && compatible(kitSkill, state.unit) ? kitSkill.id : null;
    } else {
      state.picks[slot.key] = null;
    }
  }
  return Boolean(state.unit || hasArchetype() || selectedSkills().length);
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

function fetchJson(path) {
  return fetch(path).then((res) => {
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return res.json();
  });
}

async function loadData() {
  const [skills, units, catalog, meta] = await Promise.all([
    fetchJson('data/skills.json'),
    fetchJson('data/units.json'),
    fetchJson('data/effects.json'),
    fetchJson('data/meta.json').catch(() => null),
  ]);

  data.skills = skills;
  data.units = units;
  data.catalog = catalog;
  if (meta) data.meta = meta;

  for (const effect of [...catalog.effects, ...catalog.targets]) {
    data.effectById.set(effect.id, effect);
  }
  for (const skill of skills) {
    data.skillById.set(skill.id, skill);
    if (!data.byCat.has(skill.cat)) data.byCat.set(skill.cat, []);
    data.byCat.get(skill.cat).push(skill);
    for (const effect of skill.named_effects) {
      data.effectCounts.set(effect, (data.effectCounts.get(effect) || 0) + 1);
    }
  }
  for (const unit of units) data.unitById.set(unit.id, unit);
  data.loaded = true;
}

function bindStaticEvents() {
  $('suggestions').addEventListener('click', (event) => {
    const dismiss = event.target.closest('[data-dismiss]');
    if (dismiss) {
      dismissSkill(dismiss.dataset.dismiss);
      return;
    }
    if (event.target.closest('[data-clear-filters]')) {
      Object.values(state.filters).forEach((set) => set.clear());
      renderFilters();
      syncSlotOptions();
      refresh();
      return;
    }
    const card = event.target.closest('.suggest-item');
    if (!card) return;
    const { slot, id } = card.dataset;
    if (!slot || !combos[slot]) return;
    combos[slot].setValue(id, { silent: false });
  });

  // The card is a div (a nested dismiss <button> rules out nesting buttons),
  // so Enter / Space have to be wired up by hand.
  $('suggestions').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.suggest-item');
    if (!card || event.target.closest('[data-dismiss]')) return;
    event.preventDefault();
    const { slot, id } = card.dataset;
    if (slot && combos[slot]) combos[slot].setValue(id, { silent: false });
  });

  $('dismiss-restore').addEventListener('click', restoreDismissed);

  bindFilterEvents();
}

let booted = false;

async function init() {
  if (booted) return;
  booted = true;
  renderSlotsPlaceholder();

  try {
    await loadData();
  } catch (error) {
    console.error(error);
    $('effects').innerHTML = `<p class="empty-note"><strong>Could not load the skill data.</strong><br>${esc(error.message)}<br>Run <code>python3 scripts/build_data.py</code> to regenerate <code>data/</code>.</p>`;
    document.body.dataset.ready = 'true';
    return;
  }

  $('unit-count').textContent = `${data.units.length.toLocaleString('en')} heroes`;
  combos.character = createCombo($('combo-character'), {
    placeholder: 'search heroes…',
    ariaLabel: 'character',
    onChange: (id) => applyUnit(id),
  });
  combos.character.setOptions(buildCharacterOptions());

  renderSlots();
  renderFilters();
  bindStaticEvents();

  if (readHash()) {
    combos.character.setValue(state.unit?.id || null);
    if (hasArchetype()) renderFilters();
    syncSlotOptions();
    refresh();
  } else {
    refresh();
  }

  document.body.dataset.ready = 'true';
}

function renderSlotsPlaceholder() {
  $('slots').innerHTML = SLOTS.map((slot) => `
    <div class="slot-row">
      <span class="slot-key" data-slot="${slot.key}" data-filled="false">${esc(slot.label)}</span>
      <div class="combo"><div class="combo-field is-empty"><span class="combo-value">
        <span class="cv-name">loading…</span></span></div></div>
    </div>`).join('');
}

document.addEventListener('DOMContentLoaded', init);
