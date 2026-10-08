let skillsData = [];
let primarySelectInstance = null;

// 1. Fetch JSON Database
async function initApp() {
  try {
    const response = await fetch('./skills.json');
    skillsData = await response.json();
    setupDropdowns();
  } catch (err) {
    console.error("Failed to load skills dataset:", err);
  }
}

// 2. Initialize Searchable Dropdown
function setupDropdowns() {
  const primarySelectEl = document.getElementById('primary-skill');
  
  // Format options for dropdown
  const options = skillsData.map(skill => ({
    value: skill.id,
    text: `[${skill.slot}] ${skill.name}`
  }));

  primarySelectInstance = new TomSelect(primarySelectEl, {
    options: options,
    maxItems: 1,
    placeholder: "Type to search skills...",
    onChange: (selectedId) => findSynergies(selectedId)
  });

  document.getElementById('target-slot').addEventListener('change', () => {
    const currentSelected = primarySelectInstance.getValue();
    if (currentSelected) findSynergies(currentSelected);
  });
}

// 3. Synergy Matching Engine
function findSynergies(primaryId) {
  const primarySkill = skillsData.find(s => s.id === primaryId);
  const targetSlot = document.getElementById('target-slot').value;
  const resultsContainer = document.getElementById('results-list');

  if (!primarySkill) {
    resultsContainer.innerHTML = "Select a skill above to see synergistic combinations.";
    return;
  }

  // Find candidate skills with overlapping synergy tags
  const matchedSkills = skillsData.filter(candidate => {
    // Exclude the selected skill itself
    if (candidate.id === primarySkill.id) return false;
    
    // Slot filter
    if (targetSlot !== 'ALL' && candidate.slot !== targetSlot) return false;

    // Must not share the same slot (unless comparing alternative slot options)
    if (candidate.slot === primarySkill.slot) return false;

    // Synergy Check: Candidate's tags match Primary's required synergies, or vice-versa
    const hasForwardSynergy = primarySkill.synergies.some(tag => candidate.tags.includes(tag));
    const hasReverseSynergy = candidate.synergies.some(tag => primarySkill.tags.includes(tag));

    return hasForwardSynergy || hasReverseSynergy;
  });

  renderResults(primarySkill, matchedSkills);
}

// 4. Render Synergy Cards
function renderResults(primarySkill, matches) {
  const container = document.getElementById('results-list');
  
  if (matches.length === 0) {
    container.innerHTML = `<p>No direct mechanical synergies found for <strong>${primarySkill.name}</strong> in the selected slot filter.</p>`;
    return;
  }

  container.innerHTML = matches.map(match => {
    // Find overlapping tags explaining the synergy
    const sharedForward = primarySkill.synergies.filter(tag => match.tags.includes(tag));
    const sharedReverse = match.synergies.filter(tag => primarySkill.tags.includes(tag));
    const allSynergyTags = [...new Set([...sharedForward, ...sharedReverse])];

    return `
      <div class="card">
        <h4>[${match.slot}] ${match.name}</h4>
        <p><strong>Effect:</strong> ${match.description}</p>
        <div>
          <strong>Synergy Hooks:</strong> 
          ${allSynergyTags.map(tag => `<span class="synergy-badge">${tag}</span>`).join('')}
        </div>
      </div>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', initApp);