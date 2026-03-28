/**
 * file-browser.js
 * Renders a recursive file tree in the left panel using the vault's directory
 * listing. Folders use <details>/<summary> for collapsible sections; files
 * dispatch a 'file-selected' custom event when clicked.
 */

let container = null;
let selectedEl = null;
let selectedPath = null;
let watchInterval = null;
let lastRootSnapshot = '';
let contextMenu = null;
let searchInput = null;

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

  div.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, path, name, 'file');
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

  summary.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, path, name, 'directory');
  });

  // Re-fetch contents every time the folder is opened
  details.addEventListener('toggle', async () => {
    if (details.open) {
      childContainer.innerHTML = '';
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
    empty.className = 'file-item empty-folder';
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

// ── Context Menu ────────────────────────────────────────────────

function showContextMenu(x, y, targetPath, targetName, targetType) {
  hideContextMenu();

  contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';

  const items = [];

  if (targetType === 'directory') {
    items.push({ label: 'New File Here...', action: () => showNewFileDialog(targetPath) });
    items.push({ label: 'New Folder...', action: () => promptNewFolder(targetPath) });
  }

  items.push({ label: 'Rename...', action: () => promptRename(targetPath, targetName) });
  items.push({ label: 'Delete', action: () => confirmDelete(targetPath, targetName, targetType) });

  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'context-menu-item';
    el.textContent = item.label;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu();
      item.action();
    });
    contextMenu.appendChild(el);
  }

  document.body.appendChild(contextMenu);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
  }, 0);
}

function hideContextMenu() {
  if (contextMenu) {
    contextMenu.remove();
    contextMenu = null;
  }
}

async function promptRename(oldPath, oldName) {
  const newName = prompt('Rename to:', oldName);
  if (!newName || newName === oldName) return;

  const parentDir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
  const newPath = parentDir ? parentDir + '/' + newName : newName;

  try {
    await window.harkva.renameFile(oldPath, newPath);
    await reloadTree();
  } catch (err) {
    alert('Rename failed: ' + (err.message || err));
  }
}

async function promptNewFolder(parentPath) {
  const name = prompt('Folder name:');
  if (!name) return;

  const fullPath = parentPath ? parentPath + '/' + name : name;
  try {
    await window.harkva.createDir(fullPath);
    await reloadTree();
  } catch (err) {
    alert('Failed to create folder: ' + (err.message || err));
  }
}

async function confirmDelete(targetPath, targetName, targetType) {
  const what = targetType === 'directory' ? 'folder' : 'file';
  if (!confirm(`Delete ${what} "${targetName}"? This cannot be undone.`)) return;

  try {
    await window.harkva.deleteFile(targetPath);
    if (selectedPath === targetPath) {
      selectedEl = null;
      selectedPath = null;
    }
    await reloadTree();
  } catch (err) {
    alert('Delete failed: ' + (err.message || err));
  }
}

// ── Search ──────────────────────────────────────────────────────

async function handleSearch(query) {
  if (!container) return;

  if (!query) {
    container.innerHTML = '';
    await renderTree(container, '');
    return;
  }

  try {
    const results = await window.harkva.searchFiles(query);
    container.innerHTML = '';

    if (results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No files match "' + query + '"';
      container.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const result of results) {
      if (result.type === 'file') {
        fragment.appendChild(createFileNode(result.name, result.path));
      } else {
        fragment.appendChild(createFolderNode(result.name, result.path));
      }
    }
    container.appendChild(fragment);
  } catch (err) {
    console.error('[file-browser] Search failed:', err);
  }
}

/**
 * Reload the file tree from the vault root.
 */
async function reloadTree() {
  if (!container) return;
  container.innerHTML = '';
  selectedEl = null;
  selectedPath = null;
  await renderTree(container, '');
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

  // Wire up new file button
  const newFileBtn = document.getElementById('btn-new-file');
  if (newFileBtn && window.harkva) {
    newFileBtn.addEventListener('click', () => showNewFileDialog());
  }

  const refreshFilesBtn = document.getElementById('btn-refresh-files');
  if (refreshFilesBtn) {
    refreshFilesBtn.addEventListener('click', () => reloadTree());
  }

  // Wire up search input
  searchInput = document.getElementById('file-search');
  if (searchInput) {
    let debounce = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => handleSearch(searchInput.value.trim()), 300);
    });
  }

  // Listen for menu-triggered new file dialog
  window.addEventListener('show-new-file-dialog', () => showNewFileDialog());

  // Wire up vault change button
  const changeVaultBtn = document.getElementById('btn-change-vault');
  if (changeVaultBtn && window.harkva) {
    changeVaultBtn.addEventListener('click', async () => {
      const newPath = await window.harkva.selectVault();
      if (newPath) {
        await reloadTree();
        // Update status bar
        const statusVault = document.getElementById('status-vault');
        if (statusVault) {
          const parts = newPath.replace(/\\/g, '/').split('/');
          statusVault.textContent = parts[parts.length - 1] || newPath;
        }
      }
    });
  }

  // Clear any existing content
  container.innerHTML = '';

  // Render the root of the vault
  await renderTree(container, '');

  // Take a snapshot of root entries for change detection
  lastRootSnapshot = await getRootSnapshot();

  // Poll for changes every 3 seconds so new files/folders appear automatically
  if (watchInterval) clearInterval(watchInterval);
  watchInterval = setInterval(async () => {
    const snap = await getRootSnapshot();
    if (snap !== lastRootSnapshot) {
      lastRootSnapshot = snap;
      await reloadTree();
    }
  }, 3000);
}

/**
 * Show a dialog to create a new file (supports .md, .docx, .xlsx, .pptx, etc).
 */
function showNewFileDialog() {
  if (document.getElementById('new-file-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'new-file-overlay';
  overlay.className = 'overlay';
  overlay.style.display = 'flex';

  overlay.innerHTML = `
    <div class="overlay-content" style="width:420px">
      <div class="overlay-header">
        <h3>Create New File</h3>
        <button class="close-btn" id="nf-close">&times;</button>
      </div>
      <div class="overlay-body" style="display:flex;flex-direction:column;gap:14px">
        <div>
          <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">File Name</label>
          <input id="nf-name" type="text" placeholder="e.g. report.docx"
            style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;
            background:var(--bg-primary);color:var(--text-primary);font-size:14px;outline:none;
            font-family:inherit" />
        </div>
        <div>
          <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Type</label>
          <div id="nf-types" style="display:flex;flex-wrap:wrap;gap:6px">
            <button class="header-btn nf-type-btn" data-ext=".md">Markdown</button>
            <button class="header-btn nf-type-btn" data-ext=".docx">Word (.docx)</button>
            <button class="header-btn nf-type-btn" data-ext=".xlsx">Excel (.xlsx)</button>
            <button class="header-btn nf-type-btn" data-ext=".pptx">PowerPoint (.pptx)</button>
            <button class="header-btn nf-type-btn" data-ext=".txt">Text (.txt)</button>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
          <button id="nf-cancel" class="header-btn">Cancel</button>
          <button id="nf-create" class="header-btn" style="background:var(--accent);color:#fff">Create</button>
        </div>
        <div id="nf-error" style="color:var(--error);font-size:13px;display:none"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const nameInput = document.getElementById('nf-name');
  const errorEl = document.getElementById('nf-error');

  function close() { overlay.remove(); }

  document.getElementById('nf-close').addEventListener('click', close);
  document.getElementById('nf-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Clicking a type button sets the extension on the filename
  document.querySelectorAll('.nf-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ext = btn.dataset.ext;
      let name = nameInput.value.trim();
      // Replace existing extension or add one
      const dotIdx = name.lastIndexOf('.');
      if (dotIdx > 0) {
        name = name.slice(0, dotIdx);
      }
      nameInput.value = (name || 'untitled') + ext;
      // Highlight active type
      document.querySelectorAll('.nf-type-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('nf-create').addEventListener('click', async () => {
    const filename = nameInput.value.trim();
    if (!filename) {
      errorEl.textContent = 'Please enter a file name.';
      errorEl.style.display = 'block';
      nameInput.focus();
      return;
    }

    try {
      await window.harkva.createFile(filename, filename.replace(/\.[^.]+$/, ''));
      close();
      await reloadTree();
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to create file.';
      errorEl.style.display = 'block';
    }
  });

  // Submit on Enter
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('nf-create').click();
  });

  nameInput.focus();
}

/**
 * Get a snapshot string of root directory entries for change detection.
 */
async function getRootSnapshot() {
  const entries = await fetchDir('');
  return entries.map((e) => `${e.name}:${e.type}`).sort().join(',');
}
