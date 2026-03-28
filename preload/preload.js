'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('harkva', {
  // File system
  selectVault: () => ipcRenderer.invoke('select-vault'),
  getVaultPath: () => ipcRenderer.invoke('get-vault-path'),
  listDir: (relativePath) => ipcRenderer.invoke('list-dir', relativePath),
  readFile: (relativePath) => ipcRenderer.invoke('read-file', relativePath),
  writeFile: (relativePath, content) => ipcRenderer.invoke('write-file', relativePath, content),
  createFile: (relativePath, title) => ipcRenderer.invoke('create-file', relativePath, title),
  openFile: (relativePath) => ipcRenderer.invoke('open-file', relativePath),
  deleteFile: (relativePath) => ipcRenderer.invoke('delete-file', relativePath),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  createDir: (relativePath) => ipcRenderer.invoke('create-dir', relativePath),
  searchFiles: (query) => ipcRenderer.invoke('search-files', query),

  // Claude
  startClaude: () => ipcRenderer.invoke('claude-start'),
  sendToClaude: (message) => ipcRenderer.invoke('claude-send', message),
  stopClaude: () => ipcRenderer.invoke('claude-stop'),
  onClaudeResponse: (cb) => ipcRenderer.on('claude-response', (_event, data) => cb(data)),
  onClaudeError: (cb) => ipcRenderer.on('claude-error', (_event, data) => cb(data)),
  onClaudeReady: (cb) => ipcRenderer.on('claude-ready', () => cb()),

  // Agents
  listAgents: () => ipcRenderer.invoke('list-agents'),
  switchAgent: (botFile) => ipcRenderer.invoke('switch-agent', botFile),
  getActiveAgent: () => ipcRenderer.invoke('get-active-agent'),
  createAgent: (name, systemPrompt) => ipcRenderer.invoke('create-agent', name, systemPrompt),

  // Menu events
  onVaultChanged: (cb) => ipcRenderer.on('vault-changed', (_event, path) => cb(path)),
  onShowCreateAgent: (cb) => ipcRenderer.on('show-create-agent', () => cb()),
  onShowNewFile: (cb) => ipcRenderer.on('show-new-file', () => cb()),

  // Sessions
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  loadSession: (sessionId) => ipcRenderer.invoke('load-session', sessionId),
  resumeSession: (sessionId) => ipcRenderer.invoke('resume-session', sessionId),

  // Cron
  listCronJobs: () => ipcRenderer.invoke('list-cron-jobs'),
  toggleCronJob: (id, enabled) => ipcRenderer.invoke('toggle-cron-job', id, enabled),
  getCronLog: (id) => ipcRenderer.invoke('get-cron-log', id),

  // Speech-to-text
  startSTT: () => ipcRenderer.invoke('stt-start'),
  stopSTT: () => ipcRenderer.invoke('stt-stop'),
  sendSTTAudio: (base64Data) => ipcRenderer.invoke('stt-audio', base64Data),
  onSTTResult: (cb) => ipcRenderer.on('stt-result', (_event, data) => cb(data)),
});
