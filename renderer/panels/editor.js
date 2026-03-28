/**
 * editor.js
 * Markdown editor panel for Harkva AI-OS.
 *
 * Listens for 'file-selected' events and loads the file content. Provides
 * a rendered markdown view mode and a raw-text edit mode with save support.
 */

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

/**
 * Determine whether a file path points to a markdown file.
 */
function isMarkdownFile(path) {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  return MD_EXTENSIONS.has(path.slice(dot).toLowerCase());
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
  markdownEdit.style.display = 'none';
  markdownView.style.display = '';
  btnSave.style.display = 'none';

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
