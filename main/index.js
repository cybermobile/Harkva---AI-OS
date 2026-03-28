'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { registerHandlers } = require('./ipc-handlers');
const { stopSession } = require('./claude-bridge');
const { getVaultPath, setVaultPath } = require('./file-system');

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

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // macOS app menu
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New File\u2026',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('show-new-file');
          },
        },
        { type: 'separator' },
        {
          label: 'Change Vault Folder\u2026',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (!mainWindow) return;
            const result = await dialog.showOpenDialog(mainWindow, {
              title: 'Select vault folder',
              properties: ['openDirectory', 'createDirectory'],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              setVaultPath(result.filePaths[0]);
              mainWindow.webContents.send('vault-changed', result.filePaths[0]);
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Create New Agent\u2026',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => {
            if (!mainWindow) return;
            mainWindow.webContents.send('show-create-agent');
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
        ] : [
          { role: 'close' },
        ]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC handler for creating a new agent file
ipcMain.handle('create-agent', async (_event, name, systemPrompt) => {
  const vault = getVaultPath();
  if (!vault) throw new Error('No vault configured.');

  const botsDir = path.join(vault, 'bots');
  await fs.mkdir(botsDir, { recursive: true });

  // Sanitise filename
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!safeName) throw new Error('Invalid agent name.');

  const filePath = path.join(botsDir, `${safeName}.md`);

  // Don't overwrite existing agents
  try {
    await fs.access(filePath);
    throw new Error(`Agent "${name}" already exists.`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const content = `# ${name}\n\n${systemPrompt}\n`;
  await fs.writeFile(filePath, content, 'utf-8');
  return { filename: `${safeName}.md`, name };
});

app.whenReady().then(async () => {
  // Grant microphone permission for voice mode
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'audioCapture', 'microphone'];
    callback(allowed.includes(permission));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    const allowed = ['media', 'audioCapture', 'microphone'];
    return allowed.includes(permission);
  });

  buildMenu();
  const win = createWindow();
  registerHandlers(win);

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
