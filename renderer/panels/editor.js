/**
 * editor.js
 * Markdown editor panel for Harkva AI-OS.
 *
 * Listens for 'file-selected' events and loads the file content. Provides
 * a rendered markdown view mode and a raw-text edit mode with save support.
 */

const slashCommands = { attach: () => {}, detach: () => {} };

// Load slash commands asynchronously so a failure doesn't break the editor
import('../features/slash-commands.js').then((mod) => {
  if (mod.attach) slashCommands.attach = mod.attach;
  if (mod.detach) slashCommands.detach = mod.detach;
}).catch((err) => {
  console.warn('[editor] Failed to load slash commands:', err);
});

let currentPath = null;
let currentContent = '';
let isEditing = false;
let liveWatchInterval = null;
let isDirty = false;

// DOM references
let filenameEl = null;
let markdownView = null;
let markdownEdit = null;
let btnEdit = null;
let btnSave = null;

function updateDirtyState() {
  isDirty = isEditing && markdownEdit.value !== currentContent;
  if (btnSave) btnSave.classList.toggle('dirty', isDirty);
}

function flashSaveSuccess() {
  if (!btnSave) return;
  btnSave.classList.remove('save-success');
  void btnSave.offsetWidth;
  btnSave.classList.add('save-success');
  setTimeout(() => {
    if (btnSave) btnSave.classList.remove('save-success');
  }, 1200);
}

/** File extensions treated as markdown. */
const MD_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx']);

/** Office file extensions that need special handling. */
const OFFICE_EXTENSIONS = {
  '.docx': { label: 'Word Document', icon: '📄', color: '#2B579A' },
  '.xlsx': { label: 'Excel Spreadsheet', icon: '📊', color: '#217346' },
  '.pptx': { label: 'PowerPoint Presentation', icon: '📽', color: '#D24726' },
  '.doc':  { label: 'Word Document', icon: '📄', color: '#2B579A' },
  '.xls':  { label: 'Excel Spreadsheet', icon: '📊', color: '#217346' },
  '.ppt':  { label: 'PowerPoint Presentation', icon: '📽', color: '#D24726' },
};

/**
 * Determine whether a file path points to a markdown file.
 */
function isMarkdownFile(path) {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  return MD_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/**
 * Get office file info if applicable, or null.
 */
function getOfficeInfo(path) {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return null;
  return OFFICE_EXTENSIONS[path.slice(dot).toLowerCase()] || null;
}

/**
 * Render content into the markdown view pane.
 * Markdown files get full HTML rendering; everything else is shown as
 * preformatted text.
 */
function renderContent(content, path) {
  if (isMarkdownFile(path)) {
    // marked is loaded as a global from lib/marked.min.js
    if (typeof marked !== 'undefined' && marked.parse) {
      markdownView.innerHTML = marked.parse(content);
    } else {
      markdownView.textContent = content;
    }
  } else {
    // Wrap in a code block for non-markdown files
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = content;
    pre.appendChild(code);
    markdownView.innerHTML = '';
    markdownView.appendChild(pre);
  }
}

/**
 * Switch to view mode.
 */
function enterViewMode() {
  isEditing = false;
  isDirty = false;
  slashCommands.detach();
  markdownEdit.style.display = 'none';
  markdownView.style.display = '';
  btnEdit.style.display = '';
  btnSave.style.display = 'none';
  btnSave.classList.remove('dirty');
  renderContent(currentContent, currentPath);
}

/**
 * Switch to edit mode.
 */
function enterEditMode() {
  isEditing = true;
  markdownEdit.value = currentContent;
  markdownEdit.style.display = '';
  markdownView.style.display = 'none';
  btnEdit.style.display = 'none';
  btnSave.style.display = '';
  slashCommands.attach(markdownEdit);
  updateDirtyState();
  markdownEdit.focus();
}

/**
 * Save the current file to disk via the preload bridge.
 */
async function saveFile() {
  if (!currentPath) return;

  const content = markdownEdit.value;

  try {
    if (window.harkva && typeof window.harkva.writeFile === 'function') {
      await window.harkva.writeFile(currentPath, content);
    }
    currentContent = content;
    isDirty = false;
    enterViewMode();
    flashSaveSuccess();
  } catch (err) {
    console.error('[editor] Failed to save file:', currentPath, err);
  }
}

/**
 * Load and display a file.
 */
async function loadFile(path, name) {
  if (isEditing && isDirty) {
    const shouldDiscard = window.confirm(
      'You have unsaved changes. Discard them and open a different file?'
    );
    if (!shouldDiscard) return;
  }

  currentPath = path;
  filenameEl.textContent = name || path;

  // Reset to view mode
  isEditing = false;
  isDirty = false;
  slashCommands.detach();
  markdownEdit.style.display = 'none';
  markdownView.style.display = '';
  btnSave.style.display = 'none';
  btnSave.classList.remove('dirty');

  // Check if this is an Office file
  const officeInfo = getOfficeInfo(path);
  if (officeInfo) {
    currentContent = '';
    btnEdit.style.display = 'none';
    markdownView.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'office-preview';
    card.innerHTML = `
      <div class="office-icon" style="color:${officeInfo.color}">${officeInfo.icon}</div>
      <div class="office-name">${escapeHtml(name || path)}</div>
      <div class="office-type">${officeInfo.label}</div>
      <button class="office-open-btn" style="background:${officeInfo.color}">Open in App</button>
    `;
    card.querySelector('.office-open-btn').addEventListener('click', () => {
      if (window.harkva && typeof window.harkva.openFile === 'function') {
        window.harkva.openFile(path);
      }
    });
    markdownView.appendChild(card);
    return;
  }

  try {
    if (window.harkva && typeof window.harkva.readFile === 'function') {
      currentContent = await window.harkva.readFile(path);
    } else {
      currentContent = '';
    }

    btnEdit.style.display = '';
    renderContent(currentContent, path);
  } catch (err) {
    console.error('[editor] Failed to read file:', path, err);
    currentContent = '';
    markdownView.innerHTML = `<p style="color: var(--error)">Failed to load file.</p>`;
    btnEdit.style.display = 'none';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Initialise the editor panel.
 */
export function init() {
  filenameEl = document.getElementById('editor-filename');
  markdownView = document.getElementById('markdown-view');
  markdownEdit = document.getElementById('markdown-edit');
  btnEdit = document.getElementById('btn-edit');
  btnSave = document.getElementById('btn-save');

  if (!filenameEl || !markdownView || !markdownEdit || !btnEdit || !btnSave) {
    console.warn('[editor] Missing required DOM elements.');
    return;
  }

  // Button handlers
  btnEdit.addEventListener('click', enterEditMode);
  btnSave.addEventListener('click', saveFile);
  markdownEdit.addEventListener('input', updateDirtyState);

  // Listen for file selection from the file browser
  document.addEventListener('file-selected', (event) => {
    const { path, name } = event.detail;
    loadFile(path, name);
  });
}

/**
 * Programmatic save — exposed so keyboard shortcuts in app.js can trigger it.
 */
export function save() {
  if (isEditing && currentPath) {
    saveFile();
  }
}

/**
 * Get the currently open file path (relative to vault), or null.
 */
export function getCurrentPath() {
  return currentPath;
}

/**
 * Find the line number where old and new content first differ.
 */
function findChangedLine(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const len = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < len; i++) {
    if (oldLines[i] !== newLines[i]) return i;
  }
  return -1;
}

/**
 * Scroll the markdown view so that the element containing the changed line is visible,
 * and briefly highlight it.
 */
function scrollToChange(changedLine) {
  if (!markdownView || changedLine < 0) return;

  const container = markdownView.parentElement;
  if (!container) return;

  // Get all block-level children rendered by marked
  const blocks = markdownView.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre,ul,ol,table,blockquote,hr,div');
  if (blocks.length === 0) {
    // Just scroll to bottom for plain text
    container.scrollTop = container.scrollHeight;
    return;
  }

  // Estimate which block corresponds to the changed line.
  // Count source lines consumed by each rendered block.
  let linesSoFar = 0;
  let targetBlock = blocks[blocks.length - 1]; // default to last

  for (const block of blocks) {
    const blockLines = (block.textContent || '').split('\n').length;
    if (linesSoFar + blockLines > changedLine) {
      targetBlock = block;
      break;
    }
    linesSoFar += blockLines;
  }

  // Scroll into view
  targetBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Highlight effect
  targetBlock.classList.add('ai-edited-highlight');
  setTimeout(() => targetBlock.classList.remove('ai-edited-highlight'), 1500);
}

/**
 * Reload the currently open file from disk (e.g. after AI edits it).
 */
export async function reload() {
  if (!currentPath) return;
  const officeInfo = getOfficeInfo(currentPath);
  if (officeInfo) return; // Can't live-reload binary files

  try {
    if (window.harkva && typeof window.harkva.readFile === 'function') {
      const newContent = await window.harkva.readFile(currentPath);
      if (newContent === currentContent) return; // No change

      const changedLine = findChangedLine(currentContent, newContent);
      currentContent = newContent;

      if (isEditing) {
        markdownEdit.value = currentContent;
        updateDirtyState();
        // Scroll textarea to changed line
        if (changedLine >= 0) {
          const lineHeight = parseFloat(getComputedStyle(markdownEdit).lineHeight) || 22;
          markdownEdit.scrollTop = Math.max(0, changedLine * lineHeight - markdownEdit.clientHeight / 2);
        }
      } else {
        renderContent(currentContent, currentPath);
        scrollToChange(changedLine);
      }
    }
  } catch (err) {
    console.warn('[editor] Live reload failed, file may have been deleted:', currentPath, err);
  }
}

/**
 * Start polling the open file for changes (called when AI is working).
 */
export function startLiveWatch() {
  stopLiveWatch();
  if (!currentPath) return;
  liveWatchInterval = setInterval(() => reload(), 500);
}

/**
 * Stop polling.
 */
export function stopLiveWatch() {
  if (liveWatchInterval) {
    clearInterval(liveWatchInterval);
    liveWatchInterval = null;
  }
}
