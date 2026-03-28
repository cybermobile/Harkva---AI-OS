'use strict';

const { ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const fileSystem = require('./file-system');
const claudeBridge = require('./claude-bridge');
const cronManager = require('./cron-manager');
const officeDocs = require('./office-docs');

let activeAgent = null;
let claudeResponseWired = false;

function titleCase(str) {
  return str
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function registerHandlers(mainWindow) {
  // ── File System ──────────────────────────────────────────────

  ipcMain.handle('select-vault', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select vault folder',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      fileSystem.setVaultPath(result.filePaths[0]);
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('get-vault-path', () => {
    return fileSystem.getVaultPath();
  });

  ipcMain.handle('list-dir', async (_event, relativePath) => {
    return fileSystem.listDir(relativePath || '');
  });

  ipcMain.handle('read-file', async (_event, relativePath) => {
    return fileSystem.readFile(relativePath);
  });

  ipcMain.handle('write-file', async (_event, relativePath, content) => {
    return fileSystem.writeFile(relativePath, content);
  });

  ipcMain.handle('create-file', async (_event, relativePath, title) => {
    const vaultPath = fileSystem.getVaultPath();
    if (!vaultPath) throw new Error('No vault configured.');
    const fullPath = path.join(vaultPath, relativePath);
    await officeDocs.createFile(fullPath, title);
    return true;
  });

  ipcMain.handle('open-file', async (_event, relativePath) => {
    const vaultPath = fileSystem.getVaultPath();
    if (!vaultPath) throw new Error('No vault configured.');
    const fullPath = path.join(vaultPath, relativePath);
    await shell.openPath(fullPath);
    return true;
  });

  // ── Claude ───────────────────────────────────────────────────

  function wireClaudeResponse() {
    if (claudeResponseWired) return;
    claudeResponseWired = true;

    claudeBridge.onResponse((data) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      if (data.type === 'error') {
        mainWindow.webContents.send('claude-error', data);
      } else {
        mainWindow.webContents.send('claude-response', data);
      }
    });

    claudeBridge.emitter.on('ready', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('claude-ready');
    });
  }

  ipcMain.handle('claude-start', async () => {
    const vaultPath = fileSystem.getVaultPath();

    if (!vaultPath) {
      throw new Error('No vault configured. Please select a vault folder first.');
    }

    wireClaudeResponse();

    let agentContext = null;
    if (activeAgent && activeAgent.content) {
      agentContext = activeAgent.content;
    }

    await claudeBridge.startSession(vaultPath, agentContext);
    return true;
  });

  ipcMain.handle('claude-send', async (_event, text) => {
    wireClaudeResponse();
    claudeBridge.sendMessage(text);
    return true;
  });

  ipcMain.handle('claude-stop', async () => {
    await claudeBridge.stopSession();
    return true;
  });

  // ── Agents ───────────────────────────────────────────────────

  ipcMain.handle('list-agents', async () => {
    const vaultPath = fileSystem.getVaultPath();
    if (!vaultPath) return [];

    try {
      const entries = await fileSystem.listDir('bots');
      const agents = [];
      for (const entry of entries) {
        if (entry.type === 'file' && entry.name.endsWith('.md')) {
          const baseName = entry.name.replace(/\.md$/, '');
          agents.push({
            filename: entry.name,
            name: titleCase(baseName),
          });
        }
      }
      return agents;
    } catch (_) {
      // bots/ folder may not exist
      return [];
    }
  });

  ipcMain.handle('switch-agent', async (_event, botFile) => {
    const content = await fileSystem.readFile(path.join('bots', botFile));
    const baseName = botFile.replace(/\.md$/, '');
    const name = titleCase(baseName);

    // Stop current session
    await claudeBridge.stopSession();

    activeAgent = { filename: botFile, name, content };

    // Start new session with agent context
    const vaultPath = fileSystem.getVaultPath();
    if (vaultPath) {
      wireClaudeResponse();
      await claudeBridge.startSession(vaultPath, content);
    }

    return { filename: botFile, name };
  });

  ipcMain.handle('get-active-agent', () => {
    if (activeAgent) {
      return { filename: activeAgent.filename, name: activeAgent.name };
    }
    return null;
  });

  // ── Sessions ─────────────────────────────────────────────────

  function getClaudeProjectDir(vaultPath) {
    // Claude encodes project paths by replacing / with -
    const encoded = vaultPath.replace(/\//g, '-');
    return path.join(os.homedir(), '.claude', 'projects', encoded);
  }

  ipcMain.handle('list-sessions', async () => {
    const vaultPath = fileSystem.getVaultPath();
    if (!vaultPath) return [];

    const projectDir = getClaudeProjectDir(vaultPath);
    try {
      const raw = await fs.readFile(path.join(projectDir, 'sessions-index.json'), 'utf-8');
      const index = JSON.parse(raw);
      const entries = (index.entries || [])
        .sort((a, b) => new Date(b.modified || b.created) - new Date(a.modified || a.created));
      return entries.map((e) => ({
        sessionId: e.sessionId,
        firstPrompt: e.firstPrompt || '(no prompt)',
        messageCount: e.messageCount || 0,
        created: e.created,
        modified: e.modified,
        gitBranch: e.gitBranch || '',
      }));
    } catch (_) {
      return [];
    }
  });

  ipcMain.handle('load-session', async (_event, sessionId) => {
    const vaultPath = fileSystem.getVaultPath();
    if (!vaultPath) return { messages: [] };

    const projectDir = getClaudeProjectDir(vaultPath);
    const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`);
    const messages = [];

    try {
      const raw = await fs.readFile(jsonlPath, 'utf-8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let parsed;
        try { parsed = JSON.parse(line); } catch (_) { continue; }

        if (parsed.type === 'user') {
          const msg = parsed.message;
          let content = '';
          if (typeof msg === 'string') {
            content = msg;
          } else if (msg && msg.content) {
            if (typeof msg.content === 'string') {
              content = msg.content;
            } else if (Array.isArray(msg.content)) {
              content = msg.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('\n');
            }
          }
          if (content) messages.push({ role: 'user', content });
        } else if (parsed.type === 'assistant') {
          const msg = parsed.message;
          const blocks = (msg && msg.content) || [];
          let text = '';
          for (const block of blocks) {
            if (block.type === 'text') text += block.text;
          }
          if (text) messages.push({ role: 'assistant', content: text });
        }
      }
    } catch (_) {
      // Session file not found
    }

    return { sessionId, messages };
  });

  ipcMain.handle('resume-session', async (_event, sessionId) => {
    const vaultPath = fileSystem.getVaultPath();
    if (!vaultPath) throw new Error('No vault configured.');

    await claudeBridge.stopSession();
    wireClaudeResponse();

    let agentContext = null;
    if (activeAgent && activeAgent.content) {
      agentContext = activeAgent.content;
    }

    await claudeBridge.startSession(vaultPath, agentContext, sessionId);
    return true;
  });

  // ── Cron ─────────────────────────────────────────────────────

  ipcMain.handle('list-cron-jobs', async () => {
    const jobs = await cronManager.listCronJobs();
    return jobs.map((job) => ({
      ...job,
      humanSchedule: cronManager.getHumanSchedule(job.schedule),
    }));
  });

  ipcMain.handle('toggle-cron-job', async (_event, id, enabled) => {
    return cronManager.toggleCronJob(id, enabled);
  });

  ipcMain.handle('get-cron-log', async (_event, id) => {
    return cronManager.getCronLog(id);
  });
}

module.exports = { registerHandlers };
