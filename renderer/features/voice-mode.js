/**
 * voice-mode.js
 * Voice input/output for the Harkva AI-OS chat panel.
 *
 * Provides continuous voice recognition via the Web Speech API,
 * speech synthesis of assistant replies, and a real-time
 * frequency-bar visualisation of the microphone input on a canvas.
 */

// ── State machine ────────────────────────────────────────────────
const State = Object.freeze({
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  PROCESSING: 'PROCESSING',
  SPEAKING: 'SPEAKING',
});

let currentState = State.IDLE;
let voiceActive = false;

// ── DOM handles (resolved once in init) ──────────────────────────
let toggleBtn = null;
let textInputArea = null;
let voiceIndicator = null;
let voiceCanvas = null;
let voiceStatus = null;
let canvasCtx = null;

// ── Web Speech API handles ───────────────────────────────────────
let recognition = null;

// ── Audio visualisation handles ──────────────────────────────────
let audioCtx = null;
let analyser = null;
let mediaStream = null;
let animFrameId = null;

// ── Colours for the frequency bars ───────────────────────────────
const BAR_COLOR_PRIMARY = '#E8731A';
const BAR_COLOR_SECONDARY = '#F5A623';

// ── Helpers ──────────────────────────────────────────────────────

function setState(next) {
  currentState = next;
  if (toggleBtn) toggleBtn.dataset.state = next;
  if (voiceStatus) {
    switch (next) {
      case State.IDLE:
        voiceStatus.textContent = '';
        break;
      case State.LISTENING:
        voiceStatus.textContent = 'Listening\u2026';
        break;
      case State.PROCESSING:
        voiceStatus.textContent = 'Processing\u2026';
        break;
      case State.SPEAKING:
        voiceStatus.textContent = 'Speaking\u2026';
        break;
    }
  }
}

/**
 * Strip markdown syntax so spoken output sounds natural.
 */
function stripMarkdown(text) {
  return text
    // Code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Inline code
    .replace(/`([^`]+)`/g, '$1')
    // Images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Links -- keep the label text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Bold / italic markers
    .replace(/(\*{1,3}|_{1,3})(.+?)\1/g, '$2')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '$1')
    // Headings
    .replace(/^#{1,6}\s+/gm, '')
    // Horizontal rules
    .replace(/^(\*{3,}|-{3,}|_{3,})\s*$/gm, '')
    // Unordered list bullets
    .replace(/^\s*[*+-]\s+/gm, '')
    // Ordered list numbers
    .replace(/^\s*\d+[.)]\s+/gm, '')
    // Blockquote markers
    .replace(/^\s*>\s?/gm, '')
    // HTML tags (leftover)
    .replace(/<[^>]+>/g, '')
    // Collapse whitespace
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();
}

function showTemporaryStatus(msg, duration = 3000) {
  if (voiceStatus) {
    voiceStatus.textContent = msg;
    setTimeout(() => {
      if (voiceStatus && voiceStatus.textContent === msg) {
        voiceStatus.textContent = '';
      }
    }, duration);
  }
}

// ── Audio Visualisation ──────────────────────────────────────────

function drawBars() {
  if (!analyser || !voiceCanvas || !canvasCtx) return;
  animFrameId = requestAnimationFrame(drawBars);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);

  const WIDTH = voiceCanvas.width;
  const HEIGHT = voiceCanvas.height;
  canvasCtx.clearRect(0, 0, WIDTH, HEIGHT);

  const barCount = Math.min(bufferLength, 64);
  const barWidth = (WIDTH / barCount) * 0.8;
  const gap = (WIDTH / barCount) * 0.2;
  let x = 0;

  for (let i = 0; i < barCount; i++) {
    const value = dataArray[i];
    const barHeight = (value / 255) * HEIGHT;

    // Interpolate between warm orange tones based on amplitude
    const ratio = value / 255;
    const r = Math.round(232 + (245 - 232) * ratio); // E8 -> F5
    const g = Math.round(115 + (166 - 115) * ratio); // 73 -> A6
    const b = Math.round(26 + (35 - 26) * ratio);    // 1A -> 23

    canvasCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    canvasCtx.fillRect(x, HEIGHT - barHeight, barWidth, barHeight);

    x += barWidth + gap;
  }
}

async function startVisualisation() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error('[voice-mode] Microphone access denied:', err);
    showTemporaryStatus('Microphone access denied');
    deactivateVoice();
    return;
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(mediaStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;
  source.connect(analyser);

  drawBars();
}

function stopVisualisation() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
    analyser = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (canvasCtx && voiceCanvas) {
    canvasCtx.clearRect(0, 0, voiceCanvas.width, voiceCanvas.height);
  }
}

// ── Speech Recognition ───────────────────────────────────────────

function createRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.error('[voice-mode] SpeechRecognition API not available.');
    showTemporaryStatus('Speech recognition not supported');
    return null;
  }

  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || 'en-US';

  rec.addEventListener('result', (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (interimTranscript && voiceStatus) {
      voiceStatus.textContent = `Hearing: ${interimTranscript}`;
    }

    if (finalTranscript) {
      const text = finalTranscript.trim();
      if (!text) return;

      setState(State.PROCESSING);

      // Let chat.js know so it can render a user bubble
      window.dispatchEvent(
        new CustomEvent('voice-message-sent', { detail: { transcript: text } })
      );

      // Send to Claude via the preload bridge
      if (window.harkva && typeof window.harkva.sendToClaude === 'function') {
        window.harkva.sendToClaude(text);
      }
    }
  });

  rec.addEventListener('end', () => {
    // Auto-restart if we are still supposed to be listening
    if (voiceActive && currentState !== State.SPEAKING) {
      try {
        rec.start();
        setState(State.LISTENING);
      } catch (_) {
        // Already started -- ignore
      }
    }
  });

  rec.addEventListener('error', (event) => {
    console.warn('[voice-mode] Recognition error:', event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      showTemporaryStatus('Microphone permission denied');
      deactivateVoice();
    }
    // For transient errors (network, audio-capture) the 'end' handler will restart
  });

  return rec;
}

function startRecognition() {
  if (!recognition) {
    recognition = createRecognition();
  }
  if (!recognition) return;
  try {
    recognition.start();
    setState(State.LISTENING);
  } catch (_) {
    // Already started -- ignore
  }
}

function stopRecognition() {
  if (recognition) {
    try {
      recognition.stop();
    } catch (_) {
      // Not started -- ignore
    }
  }
}

// ── Speech Synthesis ─────────────────────────────────────────────

function speakText(rawText) {
  if (!window.speechSynthesis) return;

  const cleaned = stripMarkdown(rawText);
  if (!cleaned) return;

  setState(State.SPEAKING);

  // Pause recognition to prevent feedback loop
  stopRecognition();

  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.lang = navigator.language || 'en-US';
  utterance.rate = 1;
  utterance.pitch = 1;

  utterance.addEventListener('end', () => {
    if (voiceActive) {
      startRecognition();
    } else {
      setState(State.IDLE);
    }
  });

  utterance.addEventListener('error', () => {
    if (voiceActive) {
      startRecognition();
    } else {
      setState(State.IDLE);
    }
  });

  window.speechSynthesis.cancel(); // cancel any prior utterance
  window.speechSynthesis.speak(utterance);
}

function handleAssistantResponse(event) {
  if (!voiceActive) return;
  const text =
    (event.detail && event.detail.text) ||
    (event.detail && event.detail.response) ||
    '';
  if (text) {
    speakText(text);
  }
}

// ── Activate / Deactivate ────────────────────────────────────────

async function activateVoice() {
  voiceActive = true;
  if (toggleBtn) toggleBtn.classList.add('active');
  if (textInputArea) textInputArea.style.display = 'none';
  if (voiceIndicator) voiceIndicator.style.display = 'flex';

  await startVisualisation();
  startRecognition();
}

function deactivateVoice() {
  voiceActive = false;
  setState(State.IDLE);

  stopRecognition();
  stopVisualisation();

  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  if (toggleBtn) toggleBtn.classList.remove('active');
  if (textInputArea) textInputArea.style.display = '';
  if (voiceIndicator) voiceIndicator.style.display = 'none';
}

// ── Public init ──────────────────────────────────────────────────

export function init() {
  toggleBtn = document.getElementById('voice-toggle');
  textInputArea = document.getElementById('text-input-area');
  voiceIndicator = document.getElementById('voice-indicator');
  voiceCanvas = document.getElementById('voice-canvas');
  voiceStatus = document.getElementById('voice-status');

  if (!toggleBtn) {
    console.warn('[voice-mode] #voice-toggle not found; voice mode disabled.');
    return;
  }

  // Resolve canvas context
  if (voiceCanvas) {
    voiceCanvas.width = voiceCanvas.offsetWidth || 300;
    voiceCanvas.height = voiceCanvas.offsetHeight || 80;
    canvasCtx = voiceCanvas.getContext('2d');
  }

  // Ensure indicator starts hidden
  if (voiceIndicator) voiceIndicator.style.display = 'none';

  // Toggle on click
  toggleBtn.addEventListener('click', () => {
    if (voiceActive) {
      deactivateVoice();
    } else {
      activateVoice();
    }
  });

  // Listen for completed assistant responses so we can speak them
  window.addEventListener('assistant-response-complete', handleAssistantResponse);

  // If a new chat is requested while voice mode is active, stay in voice mode
  // but cancel any in-progress speech
  window.addEventListener('new-chat-requested', () => {
    if (voiceActive && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      if (currentState !== State.LISTENING) {
        startRecognition();
      }
    }
  });

  // Clean up on window close
  window.addEventListener('beforeunload', () => {
    deactivateVoice();
  });
}
