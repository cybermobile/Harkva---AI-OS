'use strict';

const { spawn, execSync } = require('child_process');
const { EventEmitter } = require('events');
const os = require('os');
const path = require('path');
const fs = require('fs');

const emitter = new EventEmitter();
let activeProcess = null;
let sessionId = null;
let vaultPath = null;
let stoppingIntentionally = false;
let agentContext = null;
let stdoutBuffer = '';
let responseCallbacks = [];
let seenAssistantText = false;

/**
 * Resolve the full path to the `claude` binary.
 * Electron GUI apps don't inherit the user's shell PATH, so we check
 * common install locations and also try to read the login shell's PATH.
 */
function resolveClaudeBinary() {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    path.join(home, '.npm-global', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
  ];

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_) {
      // not found or not executable
    }
  }

  // Fallback: ask the user's login shell for the full PATH
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const resolved = execSync(`${shell} -l -c 'which claude'`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (resolved && fs.existsSync(resolved)) return resolved;
  } catch (_) {
    // shell lookup failed
  }

  return 'claude';
}

function emitResponse(data) {
  emitter.emit('response', data);
  for (const cb of responseCallbacks) {
    cb(data);
  }
}

/**
 * Parse a JSON line from the Claude CLI stream-json output.
 */
function handleJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_) {
    return;
  }

  // Capture session_id for --resume on subsequent messages
  if (parsed.session_id && !sessionId) {
    sessionId = parsed.session_id;
  }

  if (parsed.type === 'assistant' && parsed.message && parsed.message.content) {
    seenAssistantText = true;
    for (const block of parsed.message.content) {
      if (block.type === 'text') {
        emitResponse({ type: 'text', content: block.text });
      } else if (block.type === 'tool_use') {
        emitResponse({
          type: 'tool_use',
          content: `Using tool: ${block.name}`,
          toolName: block.name,
          toolInput: block.input || {},
          toolId: block.id || '',
        });
      }
    }
  } else if (parsed.type === 'result') {
    // Only emit result text if we didn't already get it from the assistant message
    if (parsed.result && !parsed.is_error && !seenAssistantText) {
      emitResponse({ type: 'text', content: parsed.result });
    } else if (parsed.is_error) {
      emitResponse({ type: 'error', content: parsed.result || 'Unknown error' });
    }
    seenAssistantText = false;
    if (activeProcess) activeProcess._emittedDone = true;
    emitResponse({ type: 'done', content: '' });
  } else if (parsed.type === 'error') {
    emitResponse({
      type: 'error',
      content: parsed.error || parsed.message || 'Unknown error from Claude CLI',
    });
  } else if (parsed.type === 'system') {
    emitter.emit('system', parsed);
  }
}

/**
 * Spawn a single --print process for one message exchange.
 * Uses --resume to continue the session if we have a session_id.
 */
function spawnForMessage(text) {
  const claudeBin = resolveClaudeBinary();
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ];

  // Continue existing conversation if we have a session
  if (sessionId) {
    args.push('--resume', sessionId);
  }

  // Pass message as the prompt argument
  args.push('--', text);

  stdoutBuffer = '';

  // Strip ELECTRON_RUN_AS_NODE so the claude subprocess initialises normally
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const proc = spawn(claudeBin, args, {
    cwd: vaultPath,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  activeProcess = proc;

  proc.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      handleJsonLine(line);
    }
  });

  proc.stderr.on('data', (chunk) => {
    const stderrText = chunk.toString().trim();
    if (stderrText) {
      console.error('[claude-bridge stderr]', stderrText);
    }
  });

  proc.on('error', (err) => {
    emitResponse({
      type: 'error',
      content: `Claude CLI not found. Please install Claude Code and ensure the 'claude' command is available in your PATH.\n\nError: ${err.message}`,
    });
    activeProcess = null;
  });

  proc._emittedDone = false;

  proc.on('exit', (code) => {
    // Process any remaining buffer
    if (stdoutBuffer.trim()) {
      handleJsonLine(stdoutBuffer);
      stdoutBuffer = '';
    }
    if (code !== 0 && code !== null && !stoppingIntentionally) {
      emitResponse({
        type: 'error',
        content: `Claude CLI exited with code ${code}`,
      });
    }
    // Always emit done on exit so the UI unlocks
    if (!proc._emittedDone && !stoppingIntentionally) {
      emitResponse({ type: 'done', content: '' });
    }
    stoppingIntentionally = false;
    activeProcess = null;
  });
}

/**
 * Start a new Claude session.
 * @param {string} vault - Working directory for the session
 * @param {string} [context] - Optional agent personality/context to prepend
 * @param {string} [resumeId] - Optional session ID to resume
 */
function startSession(vault, context, resumeId) {
  return new Promise(async (resolve) => {
    if (activeProcess) {
      await stopSession();
    }

    vaultPath = vault;
    agentContext = context || null;
    sessionId = resumeId || null;

    emitter.emit('ready');
    resolve();
  });
}

/**
 * Send a message to Claude.
 * Spawns a new --print process per message, using --resume for continuity.
 */
function sendMessage(text) {
  if (!vaultPath) {
    emitResponse({
      type: 'error',
      content: 'No vault configured. Please select a vault folder first.',
    });
    return;
  }

  if (activeProcess && !activeProcess.killed) {
    emitResponse({
      type: 'error',
      content: 'Claude is still processing a previous message. Please wait.',
    });
    return;
  }

  // Prepend agent context to the first message of a session
  let fullMessage = text;
  if (agentContext && !sessionId) {
    fullMessage = `${agentContext}\n\n---\n\n${text}`;
  }

  spawnForMessage(fullMessage);
}

/**
 * Stop the current Claude process gracefully.
 */
function stopSession() {
  return new Promise((resolve) => {
    if (!activeProcess) {
      resolve();
      return;
    }

    const proc = activeProcess;
    activeProcess = null;
    stdoutBuffer = '';
    stoppingIntentionally = true;

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

function isRunning() {
  return activeProcess !== null && !activeProcess.killed;
}

function onResponse(callback) {
  responseCallbacks.push(callback);
}

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
