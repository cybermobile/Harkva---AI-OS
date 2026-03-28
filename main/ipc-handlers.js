'use strict';

const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const fileSystem = require('./file-system');
const claudeBridge = require('./claude-bridge');
const cronManager = require('./cron-manager');

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
