/**
 * agent-switcher.js
 * Manages agent selection for Harkva AI-OS.
 *
 * Populates the agent dropdown from the vault's bots/ folder and handles
 * switching the active agent, updating all relevant UI labels, and
 * signalling other modules via custom events.
 */

let selectEl = null;
let chatAgentName = null;
let statusAgent = null;
let chatInput = null;

/**
 * Derive a friendly display name from a bot filename.
 * e.g. "research-assistant.md" -> "Research Assistant"
 */
function displayName(filename) {
  return filename
    .replace(/\.[^.]+$/, '')          // strip extension
    .replace(/[-_]+/g, ' ')           // dashes/underscores to spaces
    .replace(/\b\w/g, (c) => c.toUpperCase()); // title case
}

/**
 * Show a brief error flash on the select element.
 */
function flashError(message) {
  if (!selectEl) return;
  const prev = selectEl.title;
  selectEl.classList.add('error');
  selectEl.title = message;
  setTimeout(() => {
    selectEl.classList.remove('error');
    selectEl.title = prev;
  }, 2000);
}

/**
 * Apply all UI side-effects of switching to a new agent name.
 */
function applyAgentUI(name) {
  if (chatAgentName) chatAgentName.textContent = name;
  if (statusAgent) statusAgent.textContent = name;
  if (chatInput) chatInput.placeholder = `Message ${name}...`;
}

/**
 * Populate the #agent-select dropdown.
 */
async function populateAgents() {
  if (!selectEl) return;

  // Clear existing options
  selectEl.innerHTML = '';

  // Default agent is always first
  const defaultOpt = document.createElement('option');
  defaultOpt.value = 'default';
  defaultOpt.textContent = 'Chad';
  selectEl.appendChild(defaultOpt);

  try {
    if (window.harkva && typeof window.harkva.listAgents === 'function') {
      const agents = await window.harkva.listAgents();
      if (Array.isArray(agents)) {
        agents.forEach((agent) => {
          // agent may be a filename string or an object with .filename / .name
          const filename = typeof agent === 'string' ? agent : agent.filename || agent.name;
          if (!filename) return;

          const opt = document.createElement('option');
          opt.value = filename;
          opt.textContent = typeof agent === 'object' && agent.name
            ? agent.name
            : displayName(filename);
          selectEl.appendChild(opt);
        });
      }
    }
  } catch (err) {
    console.error('[agent-switcher] Failed to list agents:', err);
    flashError('Could not load agents');
  }
}

/**
 * Handle a change in the agent dropdown.
 */
async function onAgentChange() {
  const value = selectEl.value;
  const label = selectEl.options[selectEl.selectedIndex]?.textContent || 'Chad';

  try {
    if (window.harkva && typeof window.harkva.switchAgent === 'function') {
      await window.harkva.switchAgent(value === 'default' ? 'default' : value);
    }

    applyAgentUI(label);

    // Notify other modules
    window.dispatchEvent(
      new CustomEvent('agent-switched', { detail: { agent: label, value } })
    );

    // Clear the current chat
    window.dispatchEvent(new CustomEvent('new-chat-requested'));
  } catch (err) {
    console.error('[agent-switcher] Failed to switch agent:', err);
    flashError('Switch failed');
  }
}

// ─── public init ────────────────────────────────────────────────────────────

export function init() {
  selectEl = document.getElementById('agent-select');
  chatAgentName = document.getElementById('chat-agent-name');
  statusAgent = document.getElementById('status-agent');
  chatInput = document.getElementById('chat-input');

  if (!selectEl) {
    console.warn('[agent-switcher] #agent-select not found; agent switcher disabled.');
    return;
  }

  // Populate on init
  populateAgents();

  // React to user selection
  selectEl.addEventListener('change', onAgentChange);

  // If another module triggers an agent refresh (e.g. vault sync), re-populate
  window.addEventListener('agents-updated', () => {
    const currentValue = selectEl.value;
    populateAgents().then(() => {
      // Try to preserve the previous selection
      const exists = Array.from(selectEl.options).some((o) => o.value === currentValue);
      if (exists) {
        selectEl.value = currentValue;
      } else {
        selectEl.value = 'default';
        applyAgentUI('Chad');
      }
    });
  });
}
