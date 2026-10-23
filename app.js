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
  { key: 'weapon', cat: 'weapon', label: 'weapon' },
  { key: 'special', cat: 'special', label: 'special' },
  { key: 'a', cat: 'passivea', label: 'skill A' },
  { key: 'b', cat: 'passiveb', label: 'skill B' },
  { key: 'c', cat: 'passivec', label: 'skill C' },
  { key: 'seal', cat: 'sacredseal', label: 'seal' },
  { key: 'x', cat: 'passivex', label: 'skill X' },
];

const STATS = ['Atk', 'Spd', 'Def', 'Res'];
const COLORS = ['Red', 'Blue', 'Green', 'Colorless'];

/* Complementary pairings used to rank suggestions.
   [tagA, tagB, weight, reason shown to the user] */
const SYNERGY = [
  ['visible_buff', 'stat_scaling', 3, 'visible bonuses feed stat-scaling effects'],
  ['in_combat_buff', 'stat_scaling', 3, 'in-combat bonuses feed stat-scaling effects'],
  ['visible_buff', 'in_combat_buff', 1, 'overlapping bonus sources stack'],
  ['special_acceleration', 'high_cd_special', 3, 'faster cooldown for a high-cooldown Special'],
  ['special_ready', 'high_cd_special', 2, 'cooldown resets keep a heavy Special ready'],
  ['special_acceleration', 'true_damage', 2, 'more Specials means more true damage'],
  ['damage_reduction', 'healing', 2, 'sustain keeps damage reduction relevant'],
  ['damage_reduction', 'phantom_stat', 1, 'stat comparisons power mitigation'],
  ['damage_reduction', 'stat_scaling', 1, 'stat scaling powers mitigation'],
  ['phantom_stat', 'stat_scaling', 2, 'phantom bonuses win stat comparisons'],
  ['debuff', 'stat_scaling', 1, 'penalties widen stat comparisons'],
  ['visible_debuff', 'damage_reduction', 1, 'weakening the foe softens the hit'],
  ['true_damage', 'follow_up', 1, 'extra hits carry flat damage'],
  ['follow_up', 'special_acceleration', 1, 'extra hits accelerate the Special'],
  ['penalty_cleanse', 'visible_debuff', 1, 'cleansing answers penalty pressure'],
  ['bonus_negation', 'visible_buff', 1, 'bonus negation punishes buff-heavy foes'],
  ['cooldown_guard', 'high_cd_special', 1, 'cooldown control protects a heavy Special'],
  ['effective_damage', 'stat_scaling', 1, 'scaling boosts effective damage'],
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

function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/[\u2019']/g, "'");
}

/* ------------------------------------------------------------------ */
/* data + state                                                        */
/* ------------------------------------------------------------------ */

const data = {
  skills: [],
  units: [],
  skillById: new Map(),
  unitById: new Map(),
  byCat: new Map(),
  loaded: false,
};

const state = {
  unit: null,
  picks: Object.fromEntries(SLOTS.map((slot) => [slot.key, null])),
};

const combos = {};

function selectedSkills() {
  return SLOTS.map((slot) => skillFor(slot.key)).filter(Boolean);
}

function skillFor(key) {
  const id = state.picks[key];
  return id ? data.skillById.get(id) || null : null;
}

/* ------------------------------------------------------------------ */
/* restrictions                                                        */
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

function compatible(skill, unit) {
  if (skill.prf) return Boolean(unit && unit.prf && unit.prf.includes(skill.id));
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
    active = (active + delta + Math.min(filtered.length, MAX_VISIBLE_OPTIONS)) % Math.min(filtered.length, MAX_VISIBLE_OPTIONS);
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
    list.querySelectorAll('.combo-option').forEach((node, i) => node.classList.toggle('is-active', i === index));
  });

  document.addEventListener('click', (event) => {
    if (isOpen && !root.contains(event.target)) close();
  });

  return {
    setOptions(next, { keep = true } = {}) {
      options = next;
      if (keep && selectedId !== null && !optionById(selectedId)) {
        selectedId = null;
      }
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
  if (skill.cat === 'weapon') {
    const parts = [];
    if (skill.mt) parts.push(`${skill.mt} mt`);
    if (skill.rng) parts.push(`rng ${skill.rng}`);
    if (skill.sp) parts.push(`${skill.sp} SP`);
    return parts.join(' · ');
  }
  if (skill.cat === 'special') {
    const parts = [];
    if (skill.cd) parts.push(`cd ${skill.cd}`);
    if (skill.sp) parts.push(`${skill.sp} SP`);
    return parts.join(' · ');
  }
  return skill.sp ? `${skill.sp} SP` : '';
}

function displayName(skill) {
  if (!skill.refine) return skill.name;
  return `${skill.name} · refine ${skill.refine === 'skill1' ? '1' : '2'}`;
}

function badgesFor(skill, unit) {
  const badges = [];
  if (unit && unit.kit && Object.values(unit.kit).includes(skill.id)) badges.push('base kit');
  if (skill.prf) badges.push('prf');
  if (skill.refine) badges.push('refine variant');
  return badges.join(' · ');
}

function buildOptions(slot) {
  const pool = data.byCat.get(slot.cat) || [];
  return pool
    .filter((skill) => compatible(skill, state.unit))
    .map((skill) => ({
      id: skill.id,
      label: displayName(skill),
      meta: metaFor(skill),
      shortMeta: skill.sp ? `${skill.sp} SP` : '', 
      note: badgesFor(skill, state.unit),
      refine: skill.refine || null,
      keywords: [skill.fx && skill.fx.tags ? skill.fx.tags.join(' ') : '', skill.refine ? 'refine' : ''].join(' '),
    }))
    // Base skills first so the opening list is not a wall of refine variants.
    .sort((a, b) => (a.refine ? 1 : 0) - (b.refine ? 1 : 0)
      || a.label.localeCompare(b.label, 'en')
      || String(a.meta).localeCompare(String(b.meta)));
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
  const host = $('slots');
  host.innerHTML = SLOTS.map((slot) => `
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
/* rendering: effects                                                  */
/* ------------------------------------------------------------------ */

function collectEffects() {
  const groups = { flat: [], buff: [], debuff: [], buffCombat: [], debuffCombat: [], constant: [], other: [] };
  for (const slot of SLOTS) {
    const skill = skillFor(slot.key);
    if (!skill || !skill.fx) continue;
    for (const [kind, target, text, inCombat] of skill.fx.sum || []) {
      const item = { skill, target, text };
      if (kind === 'flat') groups.flat.push(item);
      else if (kind === 'buff') (inCombat ? groups.buffCombat : groups.buff).push(item);
      else if (kind === 'debuff') (inCombat ? groups.debuffCombat : groups.debuff).push(item);
      else if (kind === 'const') groups.constant.push(item);
      else groups.other.push(item);
    }
  }
  return groups;
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

function renderEffects() {
  const host = $('effects');
  const groups = collectEffects();
  const chosen = selectedSkills().length;
  const total = Object.values(groups).reduce((sum, list) => sum + list.length, 0);

  $('effect-note').textContent = chosen ? `${chosen} skill${chosen === 1 ? '' : 's'} · ${total} effects` : '';

  if (!chosen) {
    host.innerHTML = '<p class="empty-note">Select a <strong>weapon</strong>, <strong>special</strong> or passive to see its wording sorted into buffs, debuffs, flat modifiers and constants.</p>';
    return;
  }

  const combatCount = groups.buffCombat.length + groups.debuffCombat.length;
  const html = [
    fxGroup('flat modifier', groups.flat),
    fxGroup('buffs', groups.buff),
    fxGroup('debuffs', groups.debuff),
    combatCount
      ? `<div class="fx-group fx-group--combat">
           <h3>during combat <span class="count">${combatCount}</span></h3>
           ${groups.buffCombat.length ? `<div class="fx-sub"><h4>buffs</h4>${fxList(groups.buffCombat)}</div>` : ''}
           ${groups.debuffCombat.length ? `<div class="fx-sub"><h4>debuffs</h4>${fxList(groups.debuffCombat)}</div>` : ''}
         </div>`
      : '',
    fxGroup('constants', groups.constant),
    fxGroup('other effects', groups.other),
  ].join('');

  host.innerHTML = html || '<p class="empty-note">These skills carry no parsed effect lines — open their in-game description for exact wording.</p>';
}

/* ------------------------------------------------------------------ */
/* rendering: accumulated constants                                    */
/* ------------------------------------------------------------------ */

function accumulate() {
  const ally = {};
  const foe = {};
  for (const stat of STATS) {
    ally[stat] = [0, 0];
    foe[stat] = [0, 0];
  }
  for (const skill of selectedSkills()) {
    const fx = skill.fx || {};
    for (const [stat, values] of Object.entries(fx.a || {})) {
      if (!ally[stat]) ally[stat] = [0, 0];
      ally[stat][0] += values[0] || 0;
      ally[stat][1] += values[1] || 0;
    }
    for (const [stat, values] of Object.entries(fx.f || {})) {
      if (!foe[stat]) foe[stat] = [0, 0];
      foe[stat][0] += values[0] || 0;
      foe[stat][1] += values[1] || 0;
    }
  }
  return { ally, foe };
}

function breakdown(values) {
  const [visible, combat] = values;
  const parts = [];
  if (visible) parts.push(`${visible} visible`);
  if (combat) parts.push(`${combat} combat`);
  return parts.join(' · ');
}

function renderConstants() {
  const { ally, foe } = accumulate();
  const host = $('targets');
  const totalSP = selectedSkills().reduce((sum, skill) => sum + (skill.sp || 0), 0);
  const filled = selectedSkills().length;
  $('sp-note').textContent = filled ? `${filled}/${SLOTS.length} slots · ${totalSP} SP` : `${SLOTS.length} slots`;

  const any = STATS.some((stat) => ally[stat][0] + ally[stat][1] + foe[stat][0] + foe[stat][1] > 0);

  host.innerHTML = `
    <div class="targets-head">
      <span></span>
      <span class="th-ally">target: ally</span>
      <span class="th-foe">target: foe</span>
    </div>
    ${STATS.map((stat) => {
      const allyTotal = ally[stat][0] + ally[stat][1];
      const foeTotal = foe[stat][0] + foe[stat][1];
      return `
        <div class="stat-cell stat-name">${stat}</div>
        <div class="stat-cell value ${allyTotal > 0 ? 'is-positive' : 'is-zero'}">
          ${signed(allyTotal)}${allyTotal ? `<small>${esc(breakdown(ally[stat]))}</small>` : ''}
        </div>
        <div class="stat-cell value ${foeTotal > 0 ? 'is-negative' : 'is-zero'}">
          ${foeTotal ? signed(-foeTotal) : '—'}${foeTotal ? `<small>${esc(breakdown(foe[stat]))}</small>` : ''}
        </div>`;
    }).join('')}`;

  const net = STATS
    .map((stat) => ({ stat, swing: ally[stat][0] + ally[stat][1] + foe[stat][0] + foe[stat][1] }))
    .filter((row) => row.swing > 0)
    .map((row) => `<span class="net-chip">${row.stat} ${signed(row.swing)} swing</span>`)
    .join('');

  $('net-row').innerHTML = net || '<span class="panel-note">No stat bonuses or penalties in this kit yet.</span>';

  $('const-note').textContent = any
    ? 'Swing = bonuses granted to the unit and allies plus penalties inflicted on the foe. In-combat values only apply during combat.'
    : 'Visible bonuses and in-combat bonuses are tracked separately, then summed per target.';
}

/* ------------------------------------------------------------------ */
/* rendering: suggestions                                              */
/* ------------------------------------------------------------------ */

function synergyBetween(tagsA, tagsB) {
  const hits = [];
  for (const [a, b, weight, reason] of SYNERGY) {
    if ((tagsA.includes(a) && tagsB.includes(b)) || (tagsA.includes(b) && tagsB.includes(a))) {
      hits.push({ weight, reason });
    }
  }
  return hits;
}

function rankCandidates(slot, anchors) {
  const taken = new Set(selectedSkills().map((skill) => skill.id));
  const pool = (data.byCat.get(slot.cat) || []).filter((skill) => (
    !skill.prf && !taken.has(skill.id) && compatible(skill, state.unit)
  ));

  // Tags the current build already covers — repeating them adds little.
  const covered = new Set();
  for (const anchor of anchors) for (const tag of anchor.fx?.tags || []) covered.add(tag);

  // A minimal core matters most: passives before seals, specials before weapons.
  const slotWeight = { passivea: 1.15, passiveb: 1.15, passivec: 1.15, special: 1.05 }[slot.cat] || 1;

  const ranked = [];
  for (const skill of pool) {
    const tags = skill.fx?.tags || [];
    let score = 0;
    const reasons = new Map();
    for (const anchor of anchors) {
      for (const hit of synergyBetween(tags, anchor.fx?.tags || [])) {
        score += hit.weight;
        if (!reasons.has(hit.reason)) reasons.set(hit.reason, anchor.name);
      }
    }
    if (!score) continue;
    const redundant = tags.filter((tag) => covered.has(tag)).length;
    score = score * slotWeight - redundant * 0.9;
    if (score <= 0) continue;
    ranked.push({ skill, score, reasons });
  }

  ranked.sort((a, b) => b.score - a.score
    || b.reasons.size - a.reasons.size
    || (b.skill.sp || 0) - (a.skill.sp || 0)
    || a.skill.name.localeCompare(b.skill.name, 'en'));

  return ranked.slice(0, 5);
}

function renderReasons(reasons) {
  const entries = [...reasons.entries()];
  const seen = new Set();
  const unique = entries.filter(([reason]) => {
    if (seen.has(reason)) return false;
    seen.add(reason);
    return true;
  });
  entries.length = 0;
  entries.push(...unique);
  const shown = entries.slice(0, 2)
    .map(([reason, source]) => `${esc(reason)} <span class="why-src">(${esc(source)})</span>`)
    .join(' · ');
  const rest = entries.length > 2 ? ` <span class="why-more">+${entries.length - 2} more</span>` : '';
  return shown + rest;
}

function renderSuggestions() {
  const host = $('suggestions');
  const anchors = selectedSkills();
  const emptySlots = SLOTS.filter((slot) => !state.picks[slot.key]);
  const note = $('suggest-note');

  if (!anchors.length) {
    note.textContent = '';
    host.innerHTML = '<p class="empty-note">Select a hero or a few skills to see complementary picks for the empty slots.</p>';
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
  for (const slot of emptySlots) {
    const ranked = rankCandidates(slot, anchors);
    if (!ranked.length) continue;
    blocks.push(`
      <div class="suggest-block">
        <h3>${esc(slot.label)} <span class="pill pill--empty">empty</span></h3>
        <ul class="suggest-list">
          ${ranked.map(({ skill, reasons }) => `
            <li>
              <button type="button" class="suggest-item" data-slot="${esc(slot.key)}" data-id="${esc(skill.id)}">
                <span class="si-top">
                  <span class="si-name">${esc(skill.name)}</span>
                  <span class="si-meta">${esc(metaFor(skill))}</span>
                </span>
                <span class="si-why">${renderReasons(reasons)}</span>
              </button>
            </li>`).join('')}
        </ul>
      </div>`);
  }

  note.textContent = blocks.length ? `based on ${anchors.length} selected skill${anchors.length === 1 ? '' : 's'}` : '';

  host.innerHTML = blocks.join('') || `<p class="empty-note">
    No obvious complements for the remaining slots yet. Add one more skill, or pick a slot manually —
    the list is limited to skills this hero can actually inherit.</p>`;
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
  renderSuggestions();
  $('kit-note').textContent = state.unit
    ? (Object.keys(state.unit.kit || {}).length ? 'default kit prefilled' : 'no default kit data')
    : '';
  writeHash();
}

function applyUnit(unitId) {
  state.unit = unitId ? data.unitById.get(unitId) || null : null;
  const kit = state.unit?.kit || {};
  for (const slot of SLOTS) {
    const baseId = kit[slot.cat];
    const skill = baseId ? data.skillById.get(baseId) : null;
    state.picks[slot.key] = skill && compatible(skill, state.unit) ? skill.id : null;
  }
  combos.character.setValue(state.unit?.id || null);
  syncSlotOptions();
  refresh();
}

/* ------------------------------------------------------------------ */
/* url hash                                                            */
/* ------------------------------------------------------------------ */

function writeHash() {
  const params = new URLSearchParams();
  if (state.unit) params.set('unit', state.unit.id);
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
  for (const slot of SLOTS) {
    const id = params.get(slot.key);
    const skill = id ? data.skillById.get(id) : null;
    state.picks[slot.key] = skill && compatible(skill, state.unit) ? skill.id : null;
  }
  return Boolean(state.unit || selectedSkills().length);
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

async function loadData() {
  const [skills, units] = await Promise.all([
    fetch('data/skills.json').then((res) => {
      if (!res.ok) throw new Error(`skills.json → HTTP ${res.status}`);
      return res.json();
    }),
    fetch('data/units.json').then((res) => {
      if (!res.ok) throw new Error(`units.json → HTTP ${res.status}`);
      return res.json();
    }),
  ]);

  data.skills = skills;
  data.units = units;
  for (const skill of skills) {
    data.skillById.set(skill.id, skill);
    if (!data.byCat.has(skill.cat)) data.byCat.set(skill.cat, []);
    data.byCat.get(skill.cat).push(skill);
  }
  for (const unit of units) data.unitById.set(unit.id, unit);
  data.loaded = true;
}

function bindStaticEvents() {
  $('suggestions').addEventListener('click', (event) => {
    const button = event.target.closest('.suggest-item');
    if (!button) return;
    const { slot, id } = button.dataset;
    if (!slot || !combos[slot]) return;
    combos[slot].setValue(id, { silent: false });
  });
}

async function init() {
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
  bindStaticEvents();

  if (readHash()) {
    combos.character.setValue(state.unit?.id || null);
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
