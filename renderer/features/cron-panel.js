/**
 * cron-panel.js
 * Manages the cron jobs overlay for Harkva AI-OS.
 *
 * Opens/closes the overlay, fetches cron job definitions from the main
 * process, and renders them as a toggleable table.
 */

let overlay = null;
let cronList = null;
let toggleBtn = null;
let closeBtn = null;

/**
 * Fetch cron jobs from the main process.
 * Returns an array of {id, name, schedule, enabled}.
 */
async function fetchCronJobs() {
  if (!window.harkva || typeof window.harkva.listCronJobs !== 'function') {
    return [];
  }
  try {
    const jobs = await window.harkva.listCronJobs();
    return Array.isArray(jobs) ? jobs : [];
  } catch (err) {
    console.error('[cron-panel] Failed to list cron jobs:', err);
    return [];
  }
}

/**
 * Toggle a cron job's enabled state.
 */
async function toggleJob(id, enabled) {
  if (!window.harkva || typeof window.harkva.toggleCronJob !== 'function') {
    return;
  }
  try {
    await window.harkva.toggleCronJob(id, enabled);
  } catch (err) {
    console.error('[cron-panel] Failed to toggle cron job:', id, err);
  }
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
 * Render the cron jobs list into the overlay body.
 */
async function renderCronJobs() {
  if (!cronList) return;

  const jobs = await fetchCronJobs();

  if (jobs.length === 0) {
    cronList.innerHTML = '<div class="cron-empty">No cron jobs configured.</div>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'cron-table';

  table.innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Schedule</th>
        <th>Enabled</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');

  for (const job of jobs) {
    const tr = document.createElement('tr');
    const id = job.id || job.name;

    tr.innerHTML = `
      <td>${escapeHtml(job.name || 'Unnamed')}</td>
      <td><code>${escapeHtml(job.schedule || '')}</code></td>
      <td>
        <label class="toggle-switch">
          <input type="checkbox" data-job-id="${escapeHtml(String(id))}" ${job.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </td>
    `;

    const checkbox = tr.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        toggleJob(id, checkbox.checked);
      });
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  cronList.innerHTML = '';
  cronList.appendChild(table);
}

/**
 * Open the cron overlay.
 */
function openOverlay() {
  if (!overlay) return;
  overlay.style.display = 'flex';
  renderCronJobs();
}

/**
 * Close the cron overlay.
 */
function closeOverlay() {
  if (!overlay) return;
  overlay.style.display = 'none';
}

/**
 * Initialise the cron panel.
 */
export function init() {
  overlay = document.getElementById('cron-overlay');
  cronList = document.getElementById('cron-list');
  toggleBtn = document.getElementById('cron-toggle');
  closeBtn = document.getElementById('cron-close');

  if (!overlay || !toggleBtn) {
    console.warn('[cron-panel] Missing required DOM elements.');
    return;
  }

  // Toggle button opens/closes
  toggleBtn.addEventListener('click', () => {
    if (overlay.style.display === 'none' || !overlay.style.display) {
      openOverlay();
    } else {
      closeOverlay();
    }
  });

  // Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', closeOverlay);
  }

  // Close on overlay backdrop click
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeOverlay();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.style.display === 'flex') {
      closeOverlay();
    }
  });
}
