/**
 * file-browser.js
 * Renders a recursive file tree in the left panel using the vault's directory
 * listing. Folders use <details>/<summary> for collapsible sections; files
 * dispatch a 'file-selected' custom event when clicked.
 */

let container = null;
let selectedEl = null;
let selectedPath = null;

/**
 * Fetch directory contents from the main process.
 * Returns an array of {name, type} where type is 'file' or 'directory'.
 */
async function fetchDir(dirPath) {
  if (!window.harkva || typeof window.harkva.listDir !== 'function') {
    return [];
  }
  try {
    const entries = await window.harkva.listDir(dirPath);
    return Array.isArray(entries) ? entries : [];
  } catch (err) {
    console.error('[file-browser] Failed to list directory:', dirPath, err);
    return [];
  }
}

/**
 * Build the full path for a child entry.
 */
function joinPath(parent, child) {
  if (!parent) return child;
  return parent + '/' + child;
}

/**
 * Create a file element.
 */
function createFileNode(name, path) {
  const div = document.createElement('div');
  div.className = 'file-item';
  div.dataset.path = path;
  div.innerHTML = `<span class="file-icon">\u{1F4C4}</span><span class="file-name">${escapeHtml(name)}</span>`;

  div.addEventListener('click', () => {
    selectFile(div, path, name);
  });

  return div;
}

/**
 * Create a folder element with lazy-loading children.
 */
function createFolderNode(name, path) {
  const details = document.createElement('details');
  details.className = 'folder-item';

  const summary = document.createElement('summary');
  summary.innerHTML = `<span class="folder-icon">\u{1F4C1}</span><span class="folder-name">${escapeHtml(name)}</span>`;
  details.appendChild(summary);

  const childContainer = document.createElement('div');
  childContainer.className = 'folder-children';
  details.appendChild(childContainer);

  let loaded = false;

  details.addEventListener('toggle', async () => {
    if (details.open && !loaded) {
      loaded = true;
      await renderTree(childContainer, path);
    }
  });

  return details;
}

/**
 * Render directory entries into a container element.
 */
async function renderTree(parentEl, dirPath) {
  const entries = await fetchDir(dirPath);

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'file-item';
    empty.style.color = 'var(--text-secondary)';
    empty.style.fontStyle = 'italic';
    empty.textContent = 'Empty';
    parentEl.appendChild(empty);
    return;
  }

  // Sort: directories first, then alphabetical
  entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  const fragment = document.createDocumentFragment();

  for (const entry of entries) {
    const fullPath = joinPath(dirPath, entry.name);

    if (entry.type === 'directory') {
      fragment.appendChild(createFolderNode(entry.name, fullPath));
    } else {
      fragment.appendChild(createFileNode(entry.name, fullPath));
    }
  }

  parentEl.appendChild(fragment);
}

/**
 * Mark a file as selected and dispatch the event.
 */
function selectFile(el, path, name) {
  if (selectedEl) {
    selectedEl.classList.remove('selected');
  }
  el.classList.add('selected');
  selectedEl = el;
  selectedPath = path;

  document.dispatchEvent(
    new CustomEvent('file-selected', { detail: { path, name } })
  );
}

/**
 * Escape HTML entities in file/folder names.
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Initialise the file browser panel.
 * @param {string} containerId - The ID of the container element (e.g. 'file-tree').
 */
export async function init(containerId) {
  container = document.getElementById(containerId);
  if (!container) {
    console.warn('[file-browser] Container not found:', containerId);
    return;
  }

  // Clear any existing content
  container.innerHTML = '';

  // Render the root of the vault
  await renderTree(container, '');
}
