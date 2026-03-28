'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

const emitter = new EventEmitter();
let sttProcess = null;
let stdoutBuffer = '';

/**
 * Resolve the path to the compiled stt-helper binary.
 */
function resolveHelperBinary() {
  // In development, the binary is next to this file
  const devPath = path.join(__dirname, 'stt-helper');
  return devPath;
}

/**
 * Start the native macOS speech-to-text helper process.
 */
function start() {
  if (sttProcess) return;

  const bin = resolveHelperBinary();

  // Strip ELECTRON_RUN_AS_NODE so the subprocess initialises normally
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  sttProcess = spawn(bin, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  sttProcess.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      handleLine(line.trim());
    }
  });

  sttProcess.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) console.error('[stt-bridge stderr]', text);
  });

  sttProcess.on('error', (err) => {
    console.error('[stt-bridge] Failed to start stt-helper:', err.message);
    emitter.emit('error', { message: 'Speech-to-text helper not found. Compile stt-helper.swift first.' });
    sttProcess = null;
  });

  sttProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn('[stt-bridge] stt-helper exited with code', code);
    }
    sttProcess = null;
  });
}

/**
 * Stop the speech-to-text helper process.
 */
function stop() {
  if (!sttProcess) return;
  const proc = sttProcess;
  sttProcess = null;
  stdoutBuffer = '';
  proc.kill('SIGTERM');
}

/**
 * Handle a JSON line from the stt-helper process.
 */
function handleLine(line) {
  if (!line) return;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (_) {
    return;
  }

  emitter.emit('result', parsed);
}

function isRunning() {
  return sttProcess !== null;
}

module.exports = { start, stop, isRunning, emitter };
