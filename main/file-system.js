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
      directories.push({
        name: entry.name,
        type: 'directory',
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

/**
 * Delete a file or empty directory inside the vault.
 */
async function deleteFile(relativePath) {
  const fullPath = validatePath(relativePath);
  const stat = await fs.stat(fullPath);

  if (stat.isDirectory()) {
    await fs.rmdir(fullPath);
  } else {
    await fs.unlink(fullPath);
  }
}

/**
 * Rename or move a file/directory within the vault.
 */
async function renameFile(oldRelativePath, newRelativePath) {
  const oldFull = validatePath(oldRelativePath);
  const newFull = validatePath(newRelativePath);

  // Ensure destination parent exists
  const destDir = path.dirname(newFull);
  await fs.mkdir(destDir, { recursive: true });

  await fs.rename(oldFull, newFull);
}

/**
 * Create a new directory inside the vault.
 */
async function createDir(relativePath) {
  const fullPath = validatePath(relativePath);
  await fs.mkdir(fullPath, { recursive: true });
}

/**
 * Search for files by name pattern (case-insensitive substring match).
 * Returns an array of { name, path, type } for matching entries.
 */
async function searchFiles(query, relativePath = '') {
  const fullPath = validatePath(relativePath);
  const lowerQuery = query.toLowerCase();
  const results = [];

  async function walk(dir, relDir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const entryRelPath = relDir ? relDir + '/' + entry.name : entry.name;

      if (entry.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          name: entry.name,
          path: entryRelPath,
          type: entry.isDirectory() ? 'directory' : 'file',
        });
      }

      if (entry.isDirectory() && results.length < 100) {
        await walk(path.join(dir, entry.name), entryRelPath);
      }
    }
  }

  await walk(fullPath, relativePath);
  return results.slice(0, 100);
}

module.exports = {
  getVaultPath,
  setVaultPath,
  listDir,
  readFile,
  writeFile,
  deleteFile,
  renameFile,
  createDir,
  searchFiles,
};
