'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

const emitter = new EventEmitter();
let sttProcess = null;
let stdoutBuffer = '';

function resolveHelperBinary() {
  return path.join(__dirname, 'stt-helper');
}

/**
 * Start the native macOS speech-to-text helper process.
 * Audio is piped via stdin as raw Float32 PCM (mono 16kHz).
 */
function start() {
  if (sttProcess) return;

  const bin = resolveHelperBinary();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  sttProcess = spawn(bin, [], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  sttProcess.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        emitter.emit('result', parsed);
      } catch (_) {
        // skip non-JSON output
      }
    }
  });

  sttProcess.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) console.error('[stt-bridge stderr]', text);
  });

  sttProcess.on('error', (err) => {
    console.error('[stt-bridge] Failed to start stt-helper:', err.message);
    emitter.emit('result', { type: 'error', message: 'Speech helper not found. Run: swiftc -o main/stt-helper main/stt-helper.swift -framework Speech -framework AVFoundation' });
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
 * Send raw Float32 PCM audio data to the helper's stdin.
 * @param {Buffer} audioBuffer - Raw Float32 PCM data (mono, 16kHz)
 */
function sendAudio(audioBuffer) {
  if (sttProcess && sttProcess.stdin && !sttProcess.stdin.destroyed) {
    sttProcess.stdin.write(audioBuffer);
  }
}

function stop() {
  if (!sttProcess) return;
  const proc = sttProcess;
  sttProcess = null;
  stdoutBuffer = '';
  if (proc.stdin && !proc.stdin.destroyed) {
    proc.stdin.end();
  }
  proc.kill('SIGTERM');
}

function isRunning() {
  return sttProcess !== null;
}

module.exports = { start, stop, sendAudio, isRunning, emitter };
