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
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      // Future: switch between Files and Sessions views
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

  // 9. Set up panel resizers
  setupResizers();

  // 10. Set up keyboard shortcuts
  setupKeyboardShortcuts();

  // 11. Set up tab switching
  setupTabs();

  // 12. Update status bar
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
