/**
 * voice-mode.js
 * Voice input/output module for Harkva AI-OS chat panel.
 *
 * Provides hands-free interaction with the assistant using the Web Speech API
 * for recognition and synthesis, plus a real-time audio visualizer drawn on a
 * canvas element.
 */

const State = Object.freeze({
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  PROCESSING: 'PROCESSING',
  SPEAKING: 'SPEAKING',
});

let state = State.IDLE;
let recognition = null;
let audioCtx = null;
let analyser = null;
let mediaStream = null;
let animFrameId = null;

// DOM references (resolved once in init)
let toggleBtn = null;
let textInputArea = null;
let voiceIndicator = null;
let voiceCanvas = null;
let voiceStatus = null;
let canvasCtx = null;

// ─── helpers ────────────────────────────────────────────────────────────────

function setState(next) {
  state = next;
  if (toggleBtn) {
    toggleBtn.dataset.state = next;
  }
  if (voiceStatus) {
    switch (next) {
      case State.IDLE:
        voiceStatus.textContent = '';
        break;
      case State.LISTENING:
        voiceStatus.textContent = 'Listening...';
        break;
      case State.PROCESSING:
        voiceStatus.textContent = 'Processing...';
        break;
      case State.SPEAKING:
        voiceStatus.textContent = 'Speaking...';
        break;
    }
  }
}

function isActive() {
  return state !== State.IDLE;
}

/**
 * Strip markdown formatting for cleaner TTS output.
 */
function stripMarkdown(text) {
  return text
    // Code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Inline code
    .replace(/`([^`]+)`/g, '$1')
    // Images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Links – keep the label text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Bold / italic
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
    // HTML tags
    .replace(/<[^>]+>/g, '')
    // Collapse whitespace
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();
}

// ─── audio visualizer ───────────────────────────────────────────────────────

function startVisualizer() {
  if (!voiceCanvas || !analyser) return;
  canvasCtx = voiceCanvas.getContext('2d');

  const draw = () => {
    if (!analyser) return;
    animFrameId = requestAnimationFrame(draw);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const width = voiceCanvas.width;
    const height = voiceCanvas.height;

    canvasCtx.clearRect(0, 0, width, height);

    const barCount = Math.min(bufferLength, 64);
    const barWidth = (width / barCount) * 0.8;
    const gap = (width / barCount) * 0.2;
    let x = 0;

    for (let i = 0; i < barCount; i++) {
      const value = dataArray[i];
      const barHeight = (value / 255) * height;

      // Gradient between warm orange tones
      const ratio = value / 255;
      const r = Math.round(232 + (245 - 232) * ratio); // E8 -> F5
      const g = Math.round(115 + (166 - 115) * ratio); // 73 -> A6
      const b = Math.round(26 + (35 - 26) * ratio);    // 1A -> 23

      canvasCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);

      x += barWidth + gap;
    }
  };

  draw();
}

function stopVisualizer() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (canvasCtx && voiceCanvas) {
    canvasCtx.clearRect(0, 0, voiceCanvas.width, voiceCanvas.height);
  }
}

// ─── microphone / audio context ─────────────────────────────────────────────

async function acquireMicrophone() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(mediaStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    startVisualizer();
  } catch (err) {
    console.error('[voice-mode] Microphone access denied:', err);
    deactivateVoiceMode();
    showTemporaryStatus('Microphone access denied');
  }
}

function releaseMicrophone() {
  stopVisualizer();
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
    analyser = null;
  }
}

// ─── speech recognition ─────────────────────────────────────────────────────

function createRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
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
    if (state === State.LISTENING) {
      try {
        rec.start();
      } catch (_) {
        // Already started – ignore
      }
    }
  });

  rec.addEventListener('error', (event) => {
    console.warn('[voice-mode] Recognition error:', event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      deactivateVoiceMode();
      showTemporaryStatus('Microphone permission denied');
    }
    // For transient errors (network, audio-capture) the 'end' handler will restart
  });

  return rec;
}

function startRecognition() {
  if (!recognition) {
    recognition = createRecognition();
  }
  if (!recognition) return; // unsupported
  try {
    recognition.start();
    setState(State.LISTENING);
  } catch (_) {
    // Already started – ignore
  }
}

function stopRecognition() {
  if (recognition) {
    try {
      recognition.stop();
    } catch (_) {
      // Not started – ignore
    }
  }
}

// ─── speech synthesis ───────────────────────────────────────────────────────

function speak(text) {
  if (!window.speechSynthesis) return;

  const cleaned = stripMarkdown(text);
  if (!cleaned) return;

  setState(State.SPEAKING);

  // Pause recognition to prevent feedback loop
  stopRecognition();

  const utterance = new SpeechSynthesisUtterance(cleaned);
  utterance.lang = navigator.language || 'en-US';
  utterance.rate = 1;
  utterance.pitch = 1;

  utterance.addEventListener('end', () => {
    if (isActive()) {
      startRecognition();
    }
  });

  utterance.addEventListener('error', () => {
    if (isActive()) {
      startRecognition();
    }
  });

  window.speechSynthesis.cancel(); // cancel any prior utterance
  window.speechSynthesis.speak(utterance);
}

// ─── activate / deactivate ──────────────────────────────────────────────────

async function activateVoiceMode() {
  if (textInputArea) textInputArea.style.display = 'none';
  if (voiceIndicator) voiceIndicator.style.display = 'flex';
  if (toggleBtn) toggleBtn.classList.add('active');

  await acquireMicrophone();
  startRecognition();
}

function deactivateVoiceMode() {
  setState(State.IDLE);

  stopRecognition();
  releaseMicrophone();

  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  if (textInputArea) textInputArea.style.display = '';
  if (voiceIndicator) voiceIndicator.style.display = 'none';
  if (toggleBtn) toggleBtn.classList.remove('active');
}

// ─── utility ────────────────────────────────────────────────────────────────

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

// ─── public init ────────────────────────────────────────────────────────────

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

  // Ensure the indicator starts hidden
  if (voiceIndicator) voiceIndicator.style.display = 'none';

  // Toggle on click
  toggleBtn.addEventListener('click', () => {
    if (isActive()) {
      deactivateVoiceMode();
    } else {
      activateVoiceMode();
    }
  });

  // Listen for completed assistant responses so we can speak them
  window.addEventListener('assistant-response-complete', (event) => {
    if (!isActive()) return;
    const text = event.detail && event.detail.text;
    if (text) {
      speak(text);
    }
  });

  // If a new chat is requested while voice mode is active, stay in voice mode
  // but cancel any in-progress speech.
  window.addEventListener('new-chat-requested', () => {
    if (isActive() && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      if (state !== State.LISTENING) {
        startRecognition();
      }
    }
  });
}
