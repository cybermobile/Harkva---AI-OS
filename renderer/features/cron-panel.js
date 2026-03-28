/**
 * cron-panel.js
 * Cron job viewer / toggler overlay for Harkva AI-OS.
 *
 * Opens an overlay that lists all scheduled cron jobs, allows
 * enabling/disabling them, expanding to see the full command and
 * log output, and refreshing the list on demand.
 */

// ── DOM handles ──────────────────────────────────────────────────
let cronToggle = null;
let cronOverlay = null;
let cronClose = null;
let cronList = null;
let cronRefresh = null;

// ── Expanded rows tracking ───────────────────────────────────────
const expandedJobs = new Set();

// ── Day names for human-readable cron conversion ─────────────────
const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// ── Cron Expression -> Human Readable ────────────────────────────

function cronToHuman(expression) {
  if (typeof expression !== 'string') return String(expression);
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return expression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Helper: format 24h -> 12h AM/PM
  function formatTime(h, m) {
    const hh = parseInt(h, 10);
    const mm = parseInt(m, 10);
    const period = hh >= 12 ? 'PM' : 'AM';
    const displayH = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
    return `${displayH}:${String(mm).padStart(2, '0')} ${period}`;
  }

  // Helper: ordinal suffix
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // Every minute: * * * * *
  if (
    minute === '*' &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return 'Every minute';
  }

  // Every N minutes: */N * * * *
  const everyNMin = minute.match(/^\*\/(\d+)$/);
  if (
    everyNMin &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const n = parseInt(everyNMin[1], 10);
    return n === 1 ? 'Every minute' : `Every ${n} minutes`;
  }

  // Every N hours: 0 */N * * *
  const everyNHour = hour.match(/^\*\/(\d+)$/);
  if (
    minute === '0' &&
    everyNHour &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const n = parseInt(everyNHour[1], 10);
    return n === 1 ? 'Every hour' : `Every ${n} hours`;
  }

  // Specific minute every hour: M * * * *
  if (
    /^\d+$/.test(minute) &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const m = parseInt(minute, 10);
    return m === 0 ? 'Every hour' : `Every hour at minute ${m}`;
  }

  // Specific hour and minute, wildcard day/month
  if (
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    dayOfMonth === '*' &&
    month === '*'
  ) {
    const timeStr = formatTime(hour, minute);

    // Every day
    if (dayOfWeek === '*') {
      return `Daily at ${timeStr}`;
    }

    // Weekdays 1-5
    if (dayOfWeek === '1-5') {
      return `Weekdays at ${timeStr}`;
    }

    // Weekends 0,6 or 6,0
    if (dayOfWeek === '0,6' || dayOfWeek === '6,0') {
      return `Weekends at ${timeStr}`;
    }

    // Single day of week
    if (/^\d$/.test(dayOfWeek)) {
      const dayName = DAY_NAMES[parseInt(dayOfWeek, 10)] || dayOfWeek;
      return `${dayName}s at ${timeStr}`;
    }

    // Range of days
    const dayRange = dayOfWeek.match(/^(\d)-(\d)$/);
    if (dayRange) {
      const start =
        DAY_NAMES[parseInt(dayRange[1], 10)] || dayRange[1];
      const end = DAY_NAMES[parseInt(dayRange[2], 10)] || dayRange[2];
      return `${start}\u2013${end} at ${timeStr}`;
    }

    // Comma-separated days
    if (/^[\d,]+$/.test(dayOfWeek)) {
      const names = dayOfWeek
        .split(',')
        .map((d) => DAY_NAMES[parseInt(d, 10)] || d)
        .join(', ');
      return `${names} at ${timeStr}`;
    }

    return `${timeStr} on day-of-week ${dayOfWeek}`;
  }

  // Specific day of month
  if (
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    /^\d+$/.test(dayOfMonth) &&
    dayOfWeek === '*'
  ) {
    const timeStr = formatTime(hour, minute);
    const dom = parseInt(dayOfMonth, 10);

    if (month === '*') {
      return `${ordinal(dom)} of every month at ${timeStr}`;
    }
    return `${ordinal(dom)} at ${timeStr} (month ${month})`;
  }

  // Fallback: return raw expression
  return expression;
}

// ── Rendering ────────────────────────────────────────────────────

function showLoading() {
  if (!cronList) return;
  cronList.innerHTML =
    '<div class="cron-loading"><div class="cron-spinner"></div><span>Loading cron jobs\u2026</span></div>';
}

function showEmpty() {
  if (!cronList) return;
  cronList.innerHTML =
    '<div class="cron-empty">No cron jobs found</div>';
}

function showError(msg) {
  if (!cronList) return;
  cronList.innerHTML = `<div class="cron-empty" style="color:#e74c3c">${msg || 'Failed to load cron jobs'}</div>`;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '\u2026' : str;
}

function renderJobs(jobs) {
  if (!cronList) return;
  if (!jobs || jobs.length === 0) {
    showEmpty();
    return;
  }

  cronList.innerHTML = '';

  jobs.forEach((job) => {
    const id = job.id || job.name || String(Math.random());
    const schedule = job.schedule || job.cron || '';
    const command = job.command || job.cmd || '';
    const enabled = job.enabled !== false;
    const isExpanded = expandedJobs.has(id);

    // Row container
    const row = document.createElement('div');
    row.className = 'cron-row' + (isExpanded ? ' expanded' : '');
    row.dataset.id = id;

    // Header line: [Toggle] Schedule [Expand]
    const header = document.createElement('div');
    header.className = 'cron-row-header';

    // Toggle switch
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle-switch';
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = enabled;
    toggleInput.addEventListener('change', () =>
      handleToggle(id, toggleInput.checked, toggleInput)
    );
    const toggleSlider = document.createElement('span');
    toggleSlider.className = 'toggle-slider';
    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(toggleSlider);

    // Schedule (human-readable)
    const scheduleSpan = document.createElement('span');
    scheduleSpan.className = 'cron-schedule';
    scheduleSpan.textContent = cronToHuman(schedule);
    scheduleSpan.title = schedule; // raw expression on hover

    // Expand / collapse button
    const expandBtn = document.createElement('button');
    expandBtn.className = 'cron-expand-btn';
    expandBtn.textContent = isExpanded ? 'Collapse \u25B2' : 'Expand \u25BC';
    expandBtn.addEventListener('click', () =>
      toggleExpand(id, row, expandBtn)
    );

    header.appendChild(toggleLabel);
    header.appendChild(scheduleSpan);
    header.appendChild(expandBtn);

    // Command summary (truncated)
    const cmdSummary = document.createElement('div');
    cmdSummary.className = 'cron-command-summary';
    cmdSummary.textContent = truncate(command, 60);
    cmdSummary.title = command;

    row.appendChild(header);
    row.appendChild(cmdSummary);

    // Detail section (visible when expanded)
    const detail = document.createElement('div');
    detail.className = 'cron-detail';
    detail.style.display = isExpanded ? 'block' : 'none';

    const fullCmd = document.createElement('div');
    fullCmd.className = 'cron-full-command';
    fullCmd.textContent = command;

    const logBlock = document.createElement('pre');
    logBlock.className = 'cron-log';
    logBlock.textContent = 'Loading log\u2026';

    detail.appendChild(fullCmd);
    detail.appendChild(logBlock);
    row.appendChild(detail);

    cronList.appendChild(row);

    // If already expanded, fetch the log immediately
    if (isExpanded) {
      fetchLog(id, logBlock);
    }
  });
}

// ── Interactions ─────────────────────────────────────────────────

async function handleToggle(id, newState, inputEl) {
  try {
    if (window.harkva && typeof window.harkva.toggleCronJob === 'function') {
      await window.harkva.toggleCronJob(id, newState);
    }
  } catch (err) {
    console.error('[cron-panel] Failed to toggle job:', err);
    // Revert the checkbox on failure
    inputEl.checked = !newState;
  }
}

async function toggleExpand(id, rowEl, btnEl) {
  const detail = rowEl.querySelector('.cron-detail');
  if (!detail) return;

  const isNowExpanded = detail.style.display === 'none';
  detail.style.display = isNowExpanded ? 'block' : 'none';
  rowEl.classList.toggle('expanded', isNowExpanded);
  btnEl.textContent = isNowExpanded ? 'Collapse \u25B2' : 'Expand \u25BC';

  if (isNowExpanded) {
    expandedJobs.add(id);
    const logBlock = detail.querySelector('.cron-log');
    if (logBlock) {
      fetchLog(id, logBlock);
    }
  } else {
    expandedJobs.delete(id);
  }
}

async function fetchLog(id, logBlock) {
  logBlock.textContent = 'Loading log\u2026';
  try {
    if (window.harkva && typeof window.harkva.getCronLog === 'function') {
      const log = await window.harkva.getCronLog(id);
      logBlock.textContent = log || '(no log output)';
    } else {
      logBlock.textContent = '(log retrieval not available)';
    }
  } catch (err) {
    console.error('[cron-panel] Failed to fetch log:', err);
    logBlock.textContent = '(failed to load log)';
  }
}

// ── Overlay open / close ─────────────────────────────────────────

function openOverlay() {
  if (!cronOverlay) return;
  cronOverlay.classList.add('open');
  cronOverlay.style.display = 'flex';
  loadJobs();
}

function closeOverlay() {
  if (!cronOverlay) return;
  cronOverlay.classList.remove('open');
  cronOverlay.style.display = 'none';
}

async function loadJobs() {
  showLoading();
  try {
    if (window.harkva && typeof window.harkva.listCronJobs === 'function') {
      const jobs = await window.harkva.listCronJobs();
      renderJobs(jobs);
    } else {
      showEmpty();
    }
  } catch (err) {
    console.error('[cron-panel] Failed to list cron jobs:', err);
    showError('Failed to load cron jobs');
  }
}

// ── Injected styles ──────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('cron-panel-styles')) return;

  const style = document.createElement('style');
  style.id = 'cron-panel-styles';
  style.textContent = `
    /* ── Toggle switch ────────────────────────────────────── */
    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 36px;
      height: 20px;
      flex-shrink: 0;
    }
    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: #555;
      border-radius: 20px;
      transition: background-color 0.25s;
    }
    .toggle-slider::before {
      content: "";
      position: absolute;
      width: 14px;
      height: 14px;
      left: 3px;
      bottom: 3px;
      background-color: #fff;
      border-radius: 50%;
      transition: transform 0.25s;
    }
    .toggle-switch input:checked + .toggle-slider {
      background-color: #E8731A;
    }
    .toggle-switch input:checked + .toggle-slider::before {
      transform: translateX(16px);
    }

    /* ── Cron row ─────────────────────────────────────────── */
    .cron-row {
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      margin-bottom: 8px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.03);
    }
    .cron-row-header {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .cron-schedule {
      flex: 1;
      font-weight: 600;
      color: #F5A623;
      font-size: 0.9rem;
    }
    .cron-expand-btn {
      background: none;
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: rgba(255, 255, 255, 0.7);
      border-radius: 4px;
      padding: 2px 10px;
      cursor: pointer;
      font-size: 0.78rem;
      white-space: nowrap;
    }
    .cron-expand-btn:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
    }
    .cron-command-summary {
      margin-top: 4px;
      padding-left: 48px;
      color: rgba(255, 255, 255, 0.5);
      font-size: 0.82rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Expanded detail ──────────────────────────────────── */
    .cron-detail {
      margin-top: 10px;
      padding: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    .cron-full-command {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.82rem;
      color: rgba(255, 255, 255, 0.8);
      margin-bottom: 8px;
      word-break: break-all;
    }
    .cron-log {
      background: rgba(0, 0, 0, 0.3);
      border-radius: 6px;
      padding: 10px;
      font-size: 0.78rem;
      color: rgba(255, 255, 255, 0.65);
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      margin: 0;
    }

    /* ── Loading & empty states ────────────────────────────── */
    .cron-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 32px 0;
      color: rgba(255, 255, 255, 0.5);
    }
    .cron-spinner {
      width: 20px;
      height: 20px;
      border: 2px solid rgba(255, 255, 255, 0.15);
      border-top-color: #E8731A;
      border-radius: 50%;
      animation: cron-spin 0.7s linear infinite;
    }
    @keyframes cron-spin {
      to { transform: rotate(360deg); }
    }
    .cron-empty {
      text-align: center;
      padding: 32px 0;
      color: rgba(255, 255, 255, 0.4);
      font-size: 0.9rem;
    }
  `;
  document.head.appendChild(style);
}

// ── Public init ──────────────────────────────────────────────────

export function init() {
  cronToggle = document.getElementById('cron-toggle');
  cronOverlay = document.getElementById('cron-overlay');
  cronClose = document.getElementById('cron-close');
  cronList = document.getElementById('cron-list');
  cronRefresh = document.getElementById('cron-refresh');

  injectStyles();

  // Ensure overlay starts hidden
  if (cronOverlay) cronOverlay.style.display = 'none';

  // Open overlay
  if (cronToggle) {
    cronToggle.addEventListener('click', openOverlay);
  }

  // Close button
  if (cronClose) {
    cronClose.addEventListener('click', closeOverlay);
  }

  // Click on overlay background (outside the panel content) closes it
  if (cronOverlay) {
    cronOverlay.addEventListener('click', (e) => {
      if (e.target === cronOverlay) {
        closeOverlay();
      }
    });
  }

  // Refresh button
  if (cronRefresh) {
    cronRefresh.addEventListener('click', loadJobs);
  }

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (
      e.key === 'Escape' &&
      cronOverlay &&
      cronOverlay.classList.contains('open')
    ) {
      closeOverlay();
    }
  });
}
