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
}).catch(() => {});

let currentPath = null;
let currentContent = '';
let isEditing = false;

// DOM references
let filenameEl = null;
let markdownView = null;
let markdownEdit = null;
let btnEdit = null;
let btnSave = null;

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
  slashCommands.detach();
  markdownEdit.style.display = 'none';
  markdownView.style.display = '';
  btnEdit.style.display = '';
  btnSave.style.display = 'none';
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
    enterViewMode();
  } catch (err) {
    console.error('[editor] Failed to save file:', currentPath, err);
  }
}

/**
 * Load and display a file.
 */
async function loadFile(path, name) {
  currentPath = path;
  filenameEl.textContent = name || path;

  // Reset to view mode
  isEditing = false;
  slashCommands.detach();
  markdownEdit.style.display = 'none';
  markdownView.style.display = '';
  btnSave.style.display = 'none';

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
