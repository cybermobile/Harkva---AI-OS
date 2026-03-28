'use strict';

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { app } = require('electron');

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readConfig() {
  const configPath = getConfigPath();
  try {
    const raw = fsSync.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function writeConfig(config) {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
  fsSync.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

function getVaultPath() {
  const config = readConfig();
  return config.vaultPath || null;
}

function setVaultPath(vaultPath) {
  const config = readConfig();
  config.vaultPath = vaultPath;
  writeConfig(config);
}

/**
 * Validate that a relative path does not escape the vault directory.
 * Throws an error if the resolved path is outside the vault.
 */
function validatePath(relativePath) {
  const vault = getVaultPath();
  if (!vault) {
    throw new Error('No vault path configured. Please select a vault folder first.');
  }

  const resolved = path.resolve(vault, relativePath);
  const normalizedVault = path.resolve(vault);

  if (!resolved.startsWith(normalizedVault + path.sep) && resolved !== normalizedVault) {
    throw new Error('Access denied: path is outside the vault.');
  }

  return resolved;
}

/**
 * Returns a recursive directory tree as an array of entries.
 * Directories come first, then files, both sorted alphabetically.
 */
async function listDir(relativePath = '.') {
  const fullPath = validatePath(relativePath);

  let entries;
  try {
    entries = await fs.readdir(fullPath, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Directory not found: ${relativePath}`);
    }
    throw err;
  }

  const directories = [];
  const files = [];

  for (const entry of entries) {
    // Skip hidden files and directories
    if (entry.name.startsWith('.')) {
      continue;
    }

    if (entry.isDirectory()) {
      const childRelative = path.join(relativePath, entry.name);
      const children = await listDir(childRelative);
      directories.push({
        name: entry.name,
        type: 'directory',
        children,
      });
    } else if (entry.isFile()) {
      files.push({
        name: entry.name,
        type: 'file',
      });
    }
  }

  directories.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  return [...directories, ...files];
}

async function readFile(relativePath) {
  const fullPath = validatePath(relativePath);

  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`File not found: ${relativePath}`);
    }
    throw err;
  }
}

async function writeFile(relativePath, content) {
  const fullPath = validatePath(relativePath);

  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

module.exports = {
  getVaultPath,
  setVaultPath,
  listDir,
  readFile,
  writeFile,
};
