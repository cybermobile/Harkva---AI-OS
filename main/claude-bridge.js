'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const emitter = new EventEmitter();
let claudeProcess = null;
let stdoutBuffer = '';
let responseCallbacks = [];

/**
 * Parse a JSON line from the Claude CLI stream-json output
 * and emit structured response events.
 */
function handleJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_) {
    // Not valid JSON, ignore
    return;
  }

  // The stream-json format emits objects with a type field.
  // assistant messages contain content blocks.
  if (parsed.type === 'assistant' && parsed.message && parsed.message.content) {
    for (const block of parsed.message.content) {
      if (block.type === 'text') {
        emitResponse({ type: 'text', content: block.text });
      } else if (block.type === 'tool_use') {
        emitResponse({
          type: 'tool_use',
          content: `Using tool: ${block.name}`,
        });
      }
    }
  } else if (parsed.type === 'result') {
    // Final result message
    if (parsed.result) {
      emitResponse({ type: 'text', content: parsed.result });
    }
    emitResponse({ type: 'done', content: '' });
  } else if (parsed.type === 'error') {
    emitResponse({
      type: 'error',
      content: parsed.error || parsed.message || 'Unknown error from Claude CLI',
    });
  } else if (parsed.type === 'system') {
    // System messages (session info, etc.) -- can be used for ready signal
    emitter.emit('system', parsed);
  }
}

function emitResponse(data) {
  emitter.emit('response', data);
  for (const cb of responseCallbacks) {
    cb(data);
  }
}

/**
 * Start a new Claude CLI session.
 * @param {string} vaultPath - Working directory for the session
 * @param {string} [agentContext] - Optional agent personality/context to send as first message
 */
function startSession(vaultPath, agentContext) {
  return new Promise((resolve, reject) => {
    if (claudeProcess) {
      stopSession().then(() => {
        doStart(vaultPath, agentContext).then(resolve, reject);
      });
    } else {
      doStart(vaultPath, agentContext).then(resolve, reject);
    }
  });
}

function doStart(vaultPath, agentContext) {
  return new Promise((resolve, reject) => {
    stdoutBuffer = '';

    try {
      claudeProcess = spawn('claude', ['--chat', '--output-format', 'stream-json'], {
        cwd: vaultPath,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      emitResponse({
        type: 'error',
        content: 'Failed to start Claude CLI. Please ensure Claude Code is installed and available in your PATH. Install it from https://docs.anthropic.com/en/docs/claude-code',
      });
      reject(err);
      return;
    }

    claudeProcess.on('error', (err) => {
      emitResponse({
        type: 'error',
        content: `Claude CLI not found. Please install Claude Code and ensure the 'claude' command is available in your PATH. Install from https://docs.anthropic.com/en/docs/claude-code\n\nError: ${err.message}`,
      });
      claudeProcess = null;
      reject(err);
    });

    claudeProcess.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();

      const lines = stdoutBuffer.split('\n');
      // Keep the last partial line in the buffer
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        handleJsonLine(line);
      }
    });

    claudeProcess.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        console.error('[claude-bridge stderr]', text);
      }
    });

    claudeProcess.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        emitResponse({
          type: 'error',
          content: `Claude CLI exited with code ${code}`,
        });
      }
      claudeProcess = null;
      stdoutBuffer = '';
    });

    // Give the process a moment to start, then consider it ready
    // If there's an agent context, send it as the first message
    setTimeout(() => {
      if (claudeProcess && !claudeProcess.killed) {
        emitter.emit('ready');
        if (agentContext) {
          sendMessage(agentContext);
        }
        resolve();
      }
    }, 500);
  });
}

/**
 * Send a message to the Claude CLI subprocess.
 * @param {string} text - The message to send
 */
function sendMessage(text) {
  if (!claudeProcess || claudeProcess.killed) {
    emitResponse({
      type: 'error',
      content: 'Claude session is not running. Please start a session first.',
    });
    return;
  }

  try {
    claudeProcess.stdin.write(text + '\n');
  } catch (err) {
    emitResponse({
      type: 'error',
      content: `Failed to send message to Claude: ${err.message}`,
    });
  }
}

/**
 * Stop the current Claude session gracefully.
 */
function stopSession() {
  return new Promise((resolve) => {
    if (!claudeProcess) {
      resolve();
      return;
    }

    const proc = claudeProcess;
    claudeProcess = null;
    stdoutBuffer = '';

    // Try SIGTERM first
    proc.kill('SIGTERM');

    const forceKillTimeout = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch (_) {
        // Process may already be dead
      }
      resolve();
    }, 5000);

    proc.on('exit', () => {
      clearTimeout(forceKillTimeout);
      resolve();
    });
  });
}

/**
 * Check if a Claude session is currently running.
 * @returns {boolean}
 */
function isRunning() {
  return claudeProcess !== null && !claudeProcess.killed;
}

/**
 * Register a callback for Claude response chunks.
 * @param {function} callback - Receives {type, content} objects
 */
function onResponse(callback) {
  responseCallbacks.push(callback);
}

/**
 * Remove a previously registered response callback.
 * @param {function} callback
 */
function removeResponseCallback(callback) {
  responseCallbacks = responseCallbacks.filter((cb) => cb !== callback);
}

module.exports = {
  startSession,
  sendMessage,
  stopSession,
  isRunning,
  onResponse,
  removeResponseCallback,
  emitter,
};
