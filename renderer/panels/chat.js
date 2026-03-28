/**
 * chat.js
 * Chat panel for Harkva AI-OS.
 *
 * Manages a message list, renders user and assistant bubbles, handles
 * streaming responses from Claude, and provides markdown rendering for
 * assistant messages.
 */

let messages = [];
let currentAssistantBubble = null;
let currentAssistantText = '';
let isWaiting = false;

// DOM references
let messagesContainer = null;
let chatInput = null;
let btnSend = null;
let btnNewChat = null;
let agentNameEl = null;

/**
 * Escape HTML in user input to prevent injection.
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Render markdown to HTML using the global marked library.
 */
function renderMarkdown(text) {
  if (typeof marked !== 'undefined' && marked.parse) {
    return marked.parse(text);
  }
  return escapeHtml(text);
}

/**
 * Format tool input for display, showing the most relevant info concisely.
 */
function formatToolInput(toolName, input) {
  switch (toolName) {
    case 'Read':
      return input.file_path || JSON.stringify(input);
    case 'Edit':
      return input.file_path || JSON.stringify(input);
    case 'Write':
      return input.file_path || JSON.stringify(input);
    case 'Bash':
      return input.command || JSON.stringify(input);
    case 'Glob':
      return input.pattern || JSON.stringify(input);
    case 'Grep':
      return `/${input.pattern || ''}/ ${input.path || ''}`.trim();
    case 'WebFetch':
      return input.url || JSON.stringify(input);
    case 'WebSearch':
      return input.query || JSON.stringify(input);
    default: {
      const entries = Object.entries(input);
      if (entries.length === 1) return String(entries[0][1]);
      return entries.map(([k, v]) => {
        const val = typeof v === 'string' ? v : JSON.stringify(v);
        return `${k}: ${val.length > 120 ? val.slice(0, 120) + '\u2026' : val}`;
      }).join('\n');
    }
  }
}

/**
 * Create a chat bubble element.
 */
function createBubble(role, content) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;

  if (role === 'user') {
    bubble.textContent = content;
  } else if (role === 'assistant') {
    const inner = document.createElement('div');
    inner.className = 'markdown-body';
    inner.innerHTML = renderMarkdown(content);
    bubble.appendChild(inner);
  } else if (role === 'error') {
    bubble.className = 'chat-bubble error';
    bubble.textContent = content;
  }

  return bubble;
}

/**
 * Create the animated typing indicator (three bouncing dots).
 */
function createTypingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.id = 'typing-indicator';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    indicator.appendChild(dot);
  }
  return indicator;
}

/**
 * Remove the typing indicator if present.
 */
function removeTypingIndicator() {
  const existing = document.getElementById('typing-indicator');
  if (existing) existing.remove();
}

/**
 * Scroll the messages container to the bottom.
 */
function scrollToBottom() {
  if (messagesContainer) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

/**
 * Append a user message to the chat.
 */
function appendUserMessage(text) {
  messages.push({ role: 'user', content: text });
  const bubble = createBubble('user', text);
  messagesContainer.appendChild(bubble);
  scrollToBottom();
}

/**
 * Show the typing indicator.
 */
function showTypingIndicator() {
  removeTypingIndicator();
  const indicator = createTypingIndicator();
  messagesContainer.appendChild(indicator);
  scrollToBottom();
  isWaiting = true;
  if (btnSend) btnSend.disabled = true;
  if (chatInput) chatInput.placeholder = 'Waiting for response\u2026';
}

/**
 * Handle the send action: grab input, render user bubble, call Claude.
 */
function handleSend() {
  const text = chatInput.value.trim();
  if (!text || isWaiting) return;

  appendUserMessage(text);
  chatInput.value = '';

  // Auto-resize textarea back to default
  chatInput.style.height = '';

  showTypingIndicator();

  if (window.harkva && typeof window.harkva.sendToClaude === 'function') {
    window.harkva.sendToClaude(text);
  }
}

/**
 * Handle streamed response data from Claude.
 */
function handleClaudeResponse(data) {
  if (!data || !data.type) return;

  switch (data.type) {
    case 'text': {
      // First text chunk: remove typing indicator and create assistant bubble
      if (!currentAssistantBubble) {
        removeTypingIndicator();
        isWaiting = false;
        currentAssistantText = '';
        currentAssistantBubble = document.createElement('div');
        currentAssistantBubble.className = 'chat-bubble assistant';
        const inner = document.createElement('div');
        inner.className = 'markdown-body';
        currentAssistantBubble.appendChild(inner);
        messagesContainer.appendChild(currentAssistantBubble);
      }

      // Append streamed text and re-render markdown
      currentAssistantText += data.content || '';
      const inner = currentAssistantBubble.querySelector('.markdown-body');
      if (inner) {
        inner.innerHTML = renderMarkdown(currentAssistantText);
      }
      scrollToBottom();
      break;
    }

    case 'done': {
      removeTypingIndicator();
      isWaiting = false;
      if (btnSend) btnSend.disabled = false;
      if (chatInput) chatInput.placeholder = `Message ${(document.getElementById('chat-agent-name') || {}).textContent || 'Chad'}...`;

      // Stop AI glow
      document.body.classList.remove('ai-active');

      // Finalise the message
      if (currentAssistantText) {
        messages.push({ role: 'assistant', content: currentAssistantText });
      }

      // Notify other modules (e.g. voice mode) that the response is complete
      window.dispatchEvent(
        new CustomEvent('assistant-response-complete', {
          detail: { text: currentAssistantText },
        })
      );

      currentAssistantBubble = null;
      currentAssistantText = '';
      break;
    }

    case 'tool_use': {
      // Activate AI glow while using tools
      document.body.classList.add('ai-active');

      // Show tool call with its inputs
      removeTypingIndicator();
      const toolBubble = document.createElement('div');
      toolBubble.className = 'chat-bubble tool-use';

      const header = document.createElement('div');
      header.className = 'tool-use-header';
      header.textContent = data.toolName || 'Tool';
      toolBubble.appendChild(header);

      if (data.toolInput && Object.keys(data.toolInput).length > 0) {
        const inputBlock = document.createElement('pre');
        inputBlock.className = 'tool-use-input';
        inputBlock.textContent = formatToolInput(data.toolName, data.toolInput);
        toolBubble.appendChild(inputBlock);
      }

      messagesContainer.appendChild(toolBubble);
      scrollToBottom();
      break;
    }

    case 'error': {
      removeTypingIndicator();
      isWaiting = false;
      if (btnSend) btnSend.disabled = false;
      if (chatInput) chatInput.placeholder = `Message ${(document.getElementById('chat-agent-name') || {}).textContent || 'Chad'}...`;
      document.body.classList.remove('ai-active');

      const errorBubble = createBubble('error', data.content || 'An error occurred.');
      messagesContainer.appendChild(errorBubble);
      scrollToBottom();

      currentAssistantBubble = null;
      currentAssistantText = '';
      break;
    }
  }
}

/**
 * Clear all messages and reset state.
 */
async function handleNewChat() {
  messages = [];
  currentAssistantBubble = null;
  currentAssistantText = '';
  isWaiting = false;

  if (btnSend) btnSend.disabled = false;
  if (chatInput) {
    chatInput.placeholder = `Message ${(document.getElementById('chat-agent-name') || {}).textContent || 'Chad'}...`;
  }

  if (messagesContainer) {
    messagesContainer.innerHTML = '';
  }

  // Notify other modules
  window.dispatchEvent(new CustomEvent('new-chat-requested'));

  // Restart the Claude session
  try {
    if (window.harkva) {
      if (typeof window.harkva.stopClaude === 'function') {
        await window.harkva.stopClaude();
      }
      if (typeof window.harkva.startClaude === 'function') {
        await window.harkva.startClaude();
      }
    }
  } catch (err) {
    console.error('[chat] Failed to restart Claude session:', err);
  }
}

/**
 * Update the chat input placeholder with the current agent name.
 */
function updatePlaceholder(name) {
  if (chatInput) {
    chatInput.placeholder = `Message ${name}...`;
  }
}

/**
 * Initialise the chat panel.
 */
export function init() {
  messagesContainer = document.getElementById('chat-messages');
  chatInput = document.getElementById('chat-input');
  btnSend = document.getElementById('btn-send');
  btnNewChat = document.getElementById('btn-new-chat');
  agentNameEl = document.getElementById('chat-agent-name');

  if (!messagesContainer || !chatInput || !btnSend) {
    console.warn('[chat] Missing required DOM elements.');
    return;
  }

  // Send on button click
  btnSend.addEventListener('click', handleSend);

  // New chat button
  if (btnNewChat) {
    btnNewChat.addEventListener('click', handleNewChat);
  }

  // Listen for Claude response data from the preload bridge
  if (window.harkva && typeof window.harkva.onClaudeResponse === 'function') {
    window.harkva.onClaudeResponse(handleClaudeResponse);
  }

  // Listen for Claude error events (sent on a separate channel)
  if (window.harkva && typeof window.harkva.onClaudeError === 'function') {
    window.harkva.onClaudeError((data) => {
      handleClaudeResponse({ type: 'error', content: data.content || 'An error occurred.' });
    });
  }

  // Listen for voice transcriptions so they appear as user bubbles
  window.addEventListener('voice-message-sent', (event) => {
    const text = event.detail && event.detail.transcript;
    if (text) {
      appendUserMessage(text);
      showTypingIndicator();
    }
  });

  // Update placeholder when agent changes
  window.addEventListener('agent-switched', (event) => {
    const name = event.detail && event.detail.agent;
    if (name) updatePlaceholder(name);
  });

  // Handle new-chat-requested from agent switcher
  window.addEventListener('new-chat-requested', () => {
    // Only clear UI if this didn't originate from us
    if (messages.length > 0) {
      messages = [];
      currentAssistantBubble = null;
      currentAssistantText = '';
      isWaiting = false;
      if (messagesContainer) messagesContainer.innerHTML = '';
    }
  });

  // Load a past session's messages into the chat
  window.addEventListener('session-loaded', (event) => {
    const { messages: sessionMessages } = event.detail || {};
    if (!sessionMessages || !sessionMessages.length) return;

    // Clear current chat
    messages = [];
    currentAssistantBubble = null;
    currentAssistantText = '';
    isWaiting = false;
    if (messagesContainer) messagesContainer.innerHTML = '';

    // Render each historical message
    for (const msg of sessionMessages) {
      messages.push(msg);
      const bubble = createBubble(msg.role, msg.content);
      messagesContainer.appendChild(bubble);
    }
    scrollToBottom();
  });

  // Enter sends, Shift+Enter adds a newline
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Auto-resize the textarea as the user types
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });
}
