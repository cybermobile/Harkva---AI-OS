'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { getVaultPath, setVaultPath } = require('./file-system');
const { registerHandlers } = require('./ipc-handlers');
const { stopSession } = require('./claude-bridge');

let mainWindow = null;

function getMainWindow() {
  return mainWindow;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'Harkva AI-OS',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

async function promptForVault() {
  const vaultPath = getVaultPath();
  if (vaultPath && fs.existsSync(vaultPath)) {
    return;
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select your vault folder',
    message: 'Choose a folder to use as your Harkva vault. This is where your notes, agents, and files will live.',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    setVaultPath(result.filePaths[0]);
  }
}

app.whenReady().then(async () => {
  const win = createWindow();
  registerHandlers(win);

  await promptForVault();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow();
      registerHandlers(newWin);
    }
  });
});

app.on('window-all-closed', async () => {
  try {
    await stopSession();
  } catch (_) {
    // Ignore errors during cleanup
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  try {
    await stopSession();
  } catch (_) {
    // Ignore errors during cleanup
  }
});

module.exports = { getMainWindow };
