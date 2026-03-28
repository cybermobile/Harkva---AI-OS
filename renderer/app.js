/**
 * app.js
 * Boot script for Harkva AI-OS renderer.
 *
 * Initialises all panels and features, sets up panel resizers and keyboard
 * shortcuts, and kicks off the Claude session.
 */

import { init as initFileBrowser } from './panels/file-browser.js';
import { init as initEditor, save as saveEditor } from './panels/editor.js';
import { init as initChat } from './panels/chat.js';
import { init as initVoiceMode } from './features/voice-mode.js';
import { init as initAgentSwitcher } from './features/agent-switcher.js';
import { init as initCronPanel } from './features/cron-panel.js';
import { init as initSessions, show as showSessions } from './panels/sessions.js';

// ─── Panel Resizers ────────────────────────────────────────────────────────

function setupResizers() {
  const resizers = document.querySelectorAll('.panel-resizer');
  const fileBrowserPanel = document.getElementById('file-browser-panel');
  const chatPanel = document.getElementById('chat-panel');

  resizers.forEach((resizer) => {
    let startX = 0;
    let startWidth = 0;
    const side = resizer.dataset.resize; // 'left' or 'right'

    function onMouseDown(e) {
      e.preventDefault();
      startX = e.clientX;

      if (side === 'left' && fileBrowserPanel) {
        startWidth = fileBrowserPanel.getBoundingClientRect().width;
      } else if (side === 'right' && chatPanel) {
        startWidth = chatPanel.getBoundingClientRect().width;
      }

      resizer.classList.add('active');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    function onMouseMove(e) {
      const delta = e.clientX - startX;

      if (side === 'left' && fileBrowserPanel) {
        const newWidth = Math.max(180, Math.min(startWidth + delta, 500));
        fileBrowserPanel.style.width = newWidth + 'px';
      } else if (side === 'right' && chatPanel) {
        // Dragging right resizer left makes chat wider
        const newWidth = Math.max(280, Math.min(startWidth - delta, 700));
        chatPanel.style.width = newWidth + 'px';
      }
    }

    function onMouseUp() {
      resizer.classList.remove('active');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    resizer.addEventListener('mousedown', onMouseDown);
  });
}

// ─── Keyboard Shortcuts ────────────────────────────────────────────────────

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;

    // Ctrl/Cmd+S — save current file
    if (mod && e.key === 's') {
      e.preventDefault();
      saveEditor();
    }

    // Ctrl/Cmd+Enter — send chat message
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      const sendBtn = document.getElementById('btn-send');
      if (sendBtn) sendBtn.click();
    }
  });
}

// ─── Tab Switching ─────────────────────────────────────────────────────────

function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const fileBrowserPanel = document.getElementById('file-browser-panel');
  const sessionsPanel = document.getElementById('sessions-panel');
  const editorPanel = document.getElementById('editor-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      if (target === 'files') {
        if (fileBrowserPanel) fileBrowserPanel.style.display = '';
        if (sessionsPanel) sessionsPanel.style.display = 'none';
        if (editorPanel) editorPanel.style.display = '';
      } else if (target === 'sessions') {
        if (fileBrowserPanel) fileBrowserPanel.style.display = 'none';
        if (sessionsPanel) sessionsPanel.style.display = '';
        if (editorPanel) editorPanel.style.display = '';
        showSessions();
      }
    });
  });
}

// ─── Status Bar ────────────────────────────────────────────────────────────

function updateStatusBar(vaultPath) {
  const statusVault = document.getElementById('status-vault');
  const statusConnection = document.getElementById('status-connection');

  if (statusVault) {
    if (vaultPath) {
      // Show just the last directory name for brevity
      const parts = vaultPath.replace(/\\/g, '/').split('/');
      statusVault.textContent = parts[parts.length - 1] || vaultPath;
    } else {
      statusVault.textContent = 'No vault selected';
    }
  }

  if (statusConnection) {
    statusConnection.textContent = 'Connected';
    statusConnection.className = 'status-connected';
  }
}

// ─── Menu Event Handlers ──────────────────────────────────────────────────

function setupMenuListeners() {
  if (!window.harkva) return;

  // Vault changed from native menu
  if (typeof window.harkva.onVaultChanged === 'function') {
    window.harkva.onVaultChanged(async (newPath) => {
      updateStatusBar(newPath);
      await initFileBrowser('file-tree');
      window.dispatchEvent(new CustomEvent('agents-updated'));
    });
  }

  // Create Agent dialog triggered from native menu
  if (typeof window.harkva.onShowCreateAgent === 'function') {
    window.harkva.onShowCreateAgent(() => showCreateAgentDialog());
  }

  // New File dialog triggered from native menu
  if (typeof window.harkva.onShowNewFile === 'function') {
    window.harkva.onShowNewFile(() => {
      window.dispatchEvent(new CustomEvent('show-new-file-dialog'));
    });
  }
}

function showCreateAgentDialog() {
  // Don't stack dialogs
  if (document.getElementById('create-agent-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'create-agent-overlay';
  overlay.className = 'overlay';
  overlay.style.display = 'flex';

  overlay.innerHTML = `
    <div class="overlay-content" style="width:480px">
      <div class="overlay-header">
        <h3>Create New Agent</h3>
        <button class="close-btn" id="agent-dialog-close">&times;</button>
      </div>
      <div class="overlay-body" style="display:flex;flex-direction:column;gap:14px">
        <div>
          <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Agent Name</label>
          <input id="agent-name-input" type="text" placeholder="e.g. Research Assistant"
            style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;
            background:var(--bg-primary);color:var(--text-primary);font-size:14px;outline:none;
            font-family:inherit" />
        </div>
        <div style="flex:1">
          <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">System Prompt</label>
          <textarea id="agent-prompt-input" rows="8"
            placeholder="Describe this agent's personality, expertise, and how it should respond..."
            style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;
            background:var(--bg-primary);color:var(--text-primary);font-size:14px;outline:none;
            font-family:inherit;resize:vertical;line-height:1.5"></textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button id="agent-dialog-cancel" class="header-btn">Cancel</button>
          <button id="agent-dialog-create" class="header-btn"
            style="background:var(--accent);color:#fff">Create Agent</button>
        </div>
        <div id="agent-dialog-error" style="color:var(--error);font-size:13px;display:none"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const nameInput = document.getElementById('agent-name-input');
  const promptInput = document.getElementById('agent-prompt-input');
  const errorEl = document.getElementById('agent-dialog-error');

  function close() { overlay.remove(); }

  document.getElementById('agent-dialog-close').addEventListener('click', close);
  document.getElementById('agent-dialog-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  document.getElementById('agent-dialog-create').addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const prompt = promptInput.value.trim();

    if (!name) {
      errorEl.textContent = 'Please enter a name for the agent.';
      errorEl.style.display = 'block';
      nameInput.focus();
      return;
    }
    if (!prompt) {
      errorEl.textContent = 'Please enter a system prompt.';
      errorEl.style.display = 'block';
      promptInput.focus();
      return;
    }

    try {
      await window.harkva.createAgent(name, prompt);
      close();
      // Refresh the agent dropdown
      window.dispatchEvent(new CustomEvent('agents-updated'));
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to create agent.';
      errorEl.style.display = 'block';
    }
  });

  nameInput.focus();
}

// ─── Boot Sequence ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Check for vault path
  let vaultPath = null;

  if (window.harkva && typeof window.harkva.getVaultPath === 'function') {
    vaultPath = await window.harkva.getVaultPath();
  }

  // 2. If no vault, prompt user to select one
  if (!vaultPath && window.harkva && typeof window.harkva.selectVault === 'function') {
    vaultPath = await window.harkva.selectVault();
  }

  // 3. Init file browser with vault contents
  await initFileBrowser('file-tree');

  // 4. Init editor panel
  initEditor();

  // 5. Init chat panel
  initChat();

  // 6. Init agent switcher
  initAgentSwitcher();

  // 7. Init voice mode
  initVoiceMode();

  // 8. Init cron panel
  initCronPanel();

  // 8b. Init sessions panel
  initSessions('sessions-list');

  // 9. Set up panel resizers
  setupResizers();

  // 10. Set up keyboard shortcuts
  setupKeyboardShortcuts();

  // 11. Set up tab switching
  setupTabs();

  // 12. Set up menu event listeners
  setupMenuListeners();

  // 13. Update status bar
  updateStatusBar(vaultPath);

  // 13. Start Claude session
  if (window.harkva && typeof window.harkva.startClaude === 'function') {
    try {
      await window.harkva.startClaude();
    } catch (err) {
      console.error('[app] Failed to start Claude session:', err);
      const statusConnection = document.getElementById('status-connection');
      if (statusConnection) {
        statusConnection.textContent = 'Disconnected';
        statusConnection.className = 'status-disconnected';
      }
    }
  }
});
