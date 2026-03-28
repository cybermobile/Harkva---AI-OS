/**
 * sessions.js
 * Sessions panel for Harkva AI-OS.
 *
 * Lists past Claude conversations, lets users preview them, and resume
 * a session to continue the conversation where it left off.
 */

let container = null;
let sessions = [];

/**
 * Format a date string to a friendly relative/absolute label.
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Truncate text with ellipsis.
 */
function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '\u2026' : str;
}

/**
 * Escape HTML entities.
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Render the sessions list.
 */
function renderSessions() {
  if (!container) return;

  if (sessions.length === 0) {
    container.innerHTML = '<div class="sessions-empty">No past sessions found</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const session of sessions) {
    const row = document.createElement('div');
    row.className = 'session-row';
    row.dataset.sessionId = session.sessionId;

    const prompt = escapeHtml(truncate(session.firstPrompt, 80));
    const time = formatDate(session.modified || session.created);
    const msgs = session.messageCount || 0;
    const branch = session.gitBranch ? escapeHtml(truncate(session.gitBranch, 30)) : '';

    row.innerHTML = `
      <div class="session-row-main">
        <span class="session-prompt">${prompt}</span>
        <span class="session-time">${time}</span>
      </div>
      <div class="session-row-meta">
        <span class="session-msgs">${msgs} message${msgs !== 1 ? 's' : ''}</span>
        ${branch ? `<span class="session-branch">${branch}</span>` : ''}
      </div>
    `;

    row.addEventListener('click', () => handleSessionClick(session));
    fragment.appendChild(row);
  }

  container.innerHTML = '';
  container.appendChild(fragment);
}

/**
 * Handle clicking a session row — load messages and resume.
 */
async function handleSessionClick(session) {
  // Highlight selected
  const rows = container.querySelectorAll('.session-row');
  rows.forEach((r) => r.classList.remove('selected'));
  const clicked = container.querySelector(`[data-session-id="${session.sessionId}"]`);
  if (clicked) clicked.classList.add('selected');

  try {
    // Load session messages
    const data = await window.harkva.loadSession(session.sessionId);

    // Resume this session so future messages continue it
    await window.harkva.resumeSession(session.sessionId);

    // Dispatch event so chat panel can display the history
    window.dispatchEvent(
      new CustomEvent('session-loaded', {
        detail: {
          sessionId: session.sessionId,
          messages: data.messages || [],
          firstPrompt: session.firstPrompt,
        },
      })
    );

    // Switch back to Files tab view
    const filesTab = document.querySelector('.tab-btn[data-tab="files"]');
    if (filesTab) filesTab.click();
  } catch (err) {
    console.error('[sessions] Failed to load session:', err);
  }
}

/**
 * Fetch sessions from main process and render.
 */
async function loadSessions() {
  if (!container) return;
  container.innerHTML = '<div class="sessions-loading">Loading sessions\u2026</div>';

  try {
    if (window.harkva && typeof window.harkva.listSessions === 'function') {
      sessions = await window.harkva.listSessions();
    }
  } catch (err) {
    console.error('[sessions] Failed to list sessions:', err);
    sessions = [];
  }

  renderSessions();
}

/**
 * Initialise the sessions panel.
 * @param {string} containerId - The ID of the container element.
 */
export function init(containerId) {
  container = document.getElementById(containerId);
  if (!container) {
    console.warn('[sessions] Container not found:', containerId);
    return;
  }
}

/**
 * Show the sessions panel and refresh the list.
 */
export function show() {
  loadSessions();
}
