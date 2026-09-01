/**
 * oaDub - Content Script for Hybrid DOM Media Capture & Shadow DOM Floating Hub
 * 
 * Features:
 * 1. Shadow DOM Floating Hub with real-time bidirectional sync.
 * 2. Instagram & SPA CORS Audio Protection (prevents video muting / black screen).
 * 3. Ultra-low latency DOM audio capture (16kHz PCM streaming).
 * 4. In-page 24kHz PCM playback & WAV recording for mobile edge compatibility.
 */

(() => {
  // Prevent duplicate injection in the same frame
  if (window.__oaDubContentScriptLoaded) {
    return;
  }
  window.__oaDubContentScriptLoaded = true;

  // Configuration & Constants
  const TARGET_SAMPLE_RATE = 16000;
  const ACCUMULATOR_TARGET_SAMPLES = 3200; // ~200ms chunks at 16kHz

  // Internal Audio Capture State
  let isCapturing = false;
  let captureAudioContext = null;
  let playbackAudioContext = null;
  let passThroughGain = null;
  let playbackGain = null;
  let scriptProcessor = null;
  let pcmBufferAccumulator = [];
  let recordedChunks = []; // Accumulated 24kHz 16-bit Mono PCM chunks for live audio recording
  let nextPlayTime = 0;
  let currentOriginalVolume = 0.2;
  let currentTranslatedVolume = 1.0;

  // Track hooked media elements to prevent duplicate Web Audio node creation
  const hookedElements = new WeakSet();
  const hookedSources = new WeakMap();
  const trackedMediaElements = new Set();
  let mutationObserver = null;

  // Global State for UI Sync
  let isTranslating = false;
  let connectionStatus = 'idle'; // 'idle' | 'connecting' | 'connected' | 'translating' | 'error'
  let showFloatingWidget = false;

  /**
   * Safe message sender to Chrome Extension Runtime
   */
  function safeSendMessage(msg, responseCallback) {
    try {
      if (chrome.runtime && chrome.runtime.id) {
        const p = chrome.runtime.sendMessage(msg);
        if (typeof responseCallback === 'function' && p && typeof p.then === 'function') {
          p.then(responseCallback).catch(() => {});
        }
      }
    } catch (e) {
      // Ignore disconnected context errors
    }
  }

  /**
   * Resamples Float32 audio samples from inputSampleRate to 16kHz Int16 PCM.
   */
  function resampleTo16k(inputData, inputSampleRate) {
    if (inputSampleRate === TARGET_SAMPLE_RATE) {
      const output = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      return output;
    }

    const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
    const newLength = Math.round(inputData.length / ratio);
    const result = new Int16Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const originPos = i * ratio;
      const leftIndex = Math.floor(originPos);
      const rightIndex = Math.min(leftIndex + 1, inputData.length - 1);
      const weight = originPos - leftIndex;

      const interpolated = inputData[leftIndex] * (1 - weight) + inputData[rightIndex] * weight;
      const clamped = Math.max(-1, Math.min(1, interpolated));
      result[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    }

    return result;
  }

  /**
   * Converts ArrayBuffer to Base64.
   */
  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Converts Base64 to ArrayBuffer.
   */
  function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Scans DOM for all video and audio elements, attaching event listeners.
   */
  function scanAndTrackMediaElements() {
    const mediaElements = Array.from(document.querySelectorAll('video, audio'));
    
    // Also inspect open shadow roots if accessible
    document.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot && el.id !== 'oadub-floating-root') {
        const shadowMedias = el.shadowRoot.querySelectorAll('video, audio');
        shadowMedias.forEach((m) => mediaElements.push(m));
      }
    });

    mediaElements.forEach((media) => {
      if (!trackedMediaElements.has(media)) {
        trackedMediaElements.add(media);
        attachMediaListeners(media);
        if (isCapturing) {
          hookMediaElement(media);
        }
      }
    });

    checkAndNotifyMediaStatus();
  }

  /**
   * Attaches play, volumechange, and lifecycle events to a media element.
   */
  function attachMediaListeners(media) {
    const onStateChange = () => {
      checkAndNotifyMediaStatus();
      if (isCapturing && !media.paused && !media.ended) {
        hookMediaElement(media);
        if (captureAudioContext && captureAudioContext.state === 'suspended') {
          captureAudioContext.resume().catch(() => {});
        }
      }
    };

    media.addEventListener('play', onStateChange);
    media.addEventListener('playing', onStateChange);
    media.addEventListener('pause', onStateChange);
    media.addEventListener('ended', onStateChange);
    media.addEventListener('volumechange', onStateChange);
    media.addEventListener('loadeddata', onStateChange);
  }

  /**
   * Checks whether any media element is playing and whether it is muted.
   */
  function checkAndNotifyMediaStatus() {
    const medias = Array.from(trackedMediaElements).filter((m) => document.contains(m));
    let hasPlaying = false;
    let isMuted = false;

    for (const media of medias) {
      if (!media.paused && !media.ended && media.readyState >= 2) {
        hasPlaying = true;
        if (media.muted || media.volume === 0) {
          isMuted = true;
        }
        break;
      }
    }

    if (!hasPlaying && medias.length > 0) {
      const firstMedia = medias[0];
      if (firstMedia.muted || firstMedia.volume === 0) {
        isMuted = true;
      }
    }

    safeSendMessage({
      action: 'MEDIA_MUTED_STATUS',
      isMuted: isMuted,
      hasActiveMedia: hasPlaying || medias.length > 0,
      mediaCount: medias.length
    });
  }

  /**
   * Hooks a single media element into the Web Audio capture graph safely.
   * NOTE: createMediaElementSource causes cross-origin media (Instagram/TikTok videos)
   * to become permanently muted if CORS headers are missing. We strictly prioritize
   * captureStream() and never hijack video elements when not in active DOM capture mode.
   */
  function hookMediaElement(media) {
    if (!isCapturing || !captureAudioContext || hookedElements.has(media)) {
      return;
    }

    try {
      let source = null;

      // Method 1: captureStream() / mozCaptureStream() (Safe, non-destructive to DOM audio routing)
      if (typeof media.captureStream === 'function' || typeof media.mozCaptureStream === 'function') {
        try {
          const stream = typeof media.captureStream === 'function' ? media.captureStream() : media.mozCaptureStream();
          if (stream && stream.getAudioTracks().length > 0) {
            source = captureAudioContext.createMediaStreamSource(stream);
          }
        } catch (streamErr) {
          console.debug('oaDub: captureStream fallback:', streamErr);
        }
      }

      // Method 2: createMediaElementSource (Only if captureStream not supported and not cross-origin tainted)
      if (!source && typeof captureAudioContext.createMediaElementSource === 'function') {
        try {
          // Check if media is same-origin or has crossOrigin attribute
          const src = media.currentSrc || media.src;
          const isCrossOrigin = src && !src.startsWith(window.location.origin) && !src.startsWith('blob:') && !src.startsWith('data:');
          
          if (!isCrossOrigin || media.crossOrigin) {
            source = captureAudioContext.createMediaElementSource(media);
            if (passThroughGain) {
              source.connect(passThroughGain);
            }
          }
        } catch (elemSourceErr) {
          console.debug('oaDub: createMediaElementSource note:', elemSourceErr);
        }
      }

      if (source) {
        hookedElements.add(media);
        hookedSources.set(media, source);

        if (scriptProcessor) {
          source.connect(scriptProcessor);
        }
      }
    } catch (err) {
      console.warn('oaDub: Error hooking media element:', err);
    }
  }

  /**
   * Initializes the DOM Audio Capture Engine.
   */
  async function startDomCapture(config = {}) {
    if (isCapturing) {
      return;
    }

    isCapturing = true;
    pcmBufferAccumulator = [];
    recordedChunks = [];

    if (typeof config.tabOriginalVolume === 'number') {
      currentOriginalVolume = config.tabOriginalVolume;
    }
    if (typeof config.translatedVolume === 'number') {
      currentTranslatedVolume = config.translatedVolume;
    }

    // 1. Initialize Audio Context
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      console.error('oaDub: Web Audio API is not supported in this browser.');
      return;
    }

    captureAudioContext = new AudioCtx();
    if (captureAudioContext.state === 'suspended') {
      await captureAudioContext.resume().catch(() => {});
    }

    // 2. Setup Passthrough Gain Node for original sound routing
    passThroughGain = captureAudioContext.createGain();
    passThroughGain.gain.value = currentOriginalVolume;
    passThroughGain.connect(captureAudioContext.destination);

    // 3. Setup ScriptProcessorNode for 16kHz PCM streaming
    const bufferSize = 4096;
    scriptProcessor = captureAudioContext.createScriptProcessor(bufferSize, 1, 1);
    const inputSampleRate = captureAudioContext.sampleRate;

    scriptProcessor.onaudioprocess = (e) => {
      if (!isCapturing) return;

      const inputData = e.inputBuffer.getChannelData(0);
      
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);

      const resampled = resampleTo16k(inputData, inputSampleRate);
      for (let i = 0; i < resampled.length; i++) {
        pcmBufferAccumulator.push(resampled[i]);
      }

      if (pcmBufferAccumulator.length >= ACCUMULATOR_TARGET_SAMPLES) {
        const chunk = new Int16Array(pcmBufferAccumulator.splice(0, ACCUMULATOR_TARGET_SAMPLES));
        const base64Pcm = arrayBufferToBase64(chunk.buffer);
        safeSendMessage({
          action: 'DOM_PCM_CHUNK',
          pcmChunk: base64Pcm,
          rms: rms
        });
      }
    };

    scriptProcessor.connect(captureAudioContext.destination);

    // 4. Setup MutationObserver for dynamically added videos (Instagram Reels, TikTok, SPAs)
    if (!mutationObserver) {
      mutationObserver = new MutationObserver((mutations) => {
        let hasNewNodes = false;
        for (const mutation of mutations) {
          if (mutation.addedNodes && mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO' || node.querySelector('video, audio')) {
                  hasNewNodes = true;
                  break;
                }
              }
            }
          }
          if (hasNewNodes) break;
        }

        if (hasNewNodes) {
          scanAndTrackMediaElements();
        }
      });

      mutationObserver.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true
      });
    }

    // 5. Scan and hook existing media elements
    scanAndTrackMediaElements();
  }

  /**
   * Stops the DOM Audio Capture Engine and disconnects all nodes.
   */
  async function stopDomCapture() {
    isCapturing = false;
    pcmBufferAccumulator = [];

    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }

    if (scriptProcessor) {
      try {
        scriptProcessor.disconnect();
      } catch (e) {}
      scriptProcessor = null;
    }

    if (passThroughGain) {
      try {
        passThroughGain.disconnect();
      } catch (e) {}
      passThroughGain = null;
    }

    if (captureAudioContext) {
      try {
        await captureAudioContext.close();
      } catch (e) {}
      captureAudioContext = null;
    }
  }

  /**
   * Unmutes all active and found media elements on the page.
   */
  function unmuteActiveMedia() {
    scanAndTrackMediaElements();
    const medias = Array.from(trackedMediaElements).filter((m) => document.contains(m));

    medias.forEach((media) => {
      try {
        media.muted = false;
        if (media.volume === 0) {
          media.volume = 1.0;
        }
        if (media.paused) {
          media.play().catch(() => {});
        }
      } catch (err) {
        console.warn('oaDub: Unmute error on element:', err);
      }
    });

    checkAndNotifyMediaStatus();
  }

  /**
   * Plays a 24kHz 16-bit Mono PCM translated chunk directly in the page context.
   */
  async function playAudioChunk(base64Data) {
    if (!playbackAudioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      playbackAudioContext = new AudioCtx({ sampleRate: 24000 });
      playbackGain = playbackAudioContext.createGain();
      playbackGain.gain.value = currentTranslatedVolume;
      playbackGain.connect(playbackAudioContext.destination);
      nextPlayTime = playbackAudioContext.currentTime;
    }

    if (playbackAudioContext.state === 'suspended') {
      await playbackAudioContext.resume().catch(() => {});
    }

    const arrayBuffer = base64ToArrayBuffer(base64Data);
    const int16Array = new Int16Array(arrayBuffer);
    recordedChunks.push(int16Array);
    const float32Array = new Float32Array(int16Array.length);

    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    const audioBuffer = playbackAudioContext.createBuffer(1, float32Array.length, 24000);
    audioBuffer.copyToChannel(float32Array, 0);

    const source = playbackAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(playbackGain);

    const currentTime = playbackAudioContext.currentTime;
    if (nextPlayTime < currentTime) {
      nextPlayTime = currentTime;
    } else if (nextPlayTime > currentTime + 1.2) {
      nextPlayTime = currentTime + 0.1;
    }

    const startTime = nextPlayTime;
    source.start(startTime);
    nextPlayTime += audioBuffer.duration;
  }

  /**
   * Updates local volume gains.
   */
  function updateVolumes(tabVol, transVol) {
    if (typeof tabVol === 'number') {
      currentOriginalVolume = tabVol;
      if (passThroughGain && captureAudioContext) {
        passThroughGain.gain.setValueAtTime(tabVol, captureAudioContext.currentTime);
      }
      if (floatingOriginalSlider) {
        floatingOriginalSlider.value = Math.round(tabVol * 100);
      }
      if (floatingOrigVal) {
        floatingOrigVal.textContent = `${Math.round(tabVol * 100)}%`;
      }
    }
    if (typeof transVol === 'number') {
      currentTranslatedVolume = transVol;
      if (playbackGain && playbackAudioContext) {
        playbackGain.gain.setValueAtTime(transVol, playbackAudioContext.currentTime);
      }
      if (floatingTranslatedSlider) {
        floatingTranslatedSlider.value = Math.round(transVol * 100);
      }
      if (floatingTransVal) {
        floatingTransVal.textContent = `${Math.round(transVol * 100)}%`;
      }
    }
  }

  /**
   * Encodes an array of Int16Array PCM sample chunks into a standard RIFF WAVE ArrayBuffer.
   */
  function encodeWAV(samplesList, sampleRate = 24000) {
    let totalSamples = 0;
    for (const chunk of samplesList) {
      totalSamples += chunk.length;
    }
    const bytesPerSample = 2;
    const channels = 1;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = totalSamples * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);

    // data sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write PCM data
    let offset = 44;
    for (const chunk of samplesList) {
      for (let i = 0; i < chunk.length; i++) {
        view.setInt16(offset, chunk[i], true);
        offset += 2;
      }
    }

    return buffer;
  }

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // =========================================================================
  // SHADOW DOM FLOATING HUB IMPLEMENTATION
  // =========================================================================

  let floatingRootEl = null;
  let shadowRoot = null;
  let floatingBadge = null;
  let floatingPanel = null;
  let floatingToggleBtn = null;
  let floatingOriginalSlider = null;
  let floatingOrigVal = null;
  let floatingTranslatedSlider = null;
  let floatingTransVal = null;
  let floatingDownloadBtn = null;
  let floatingHideSiteBtn = null;
  let floatingStatusBadge = null;
  let floatingStatusText = null;
  let isPanelOpen = false;

  function initFloatingHub() {
    // Only inject in top window frame to prevent multiple widgets in iframes
    if (window.self !== window.top) {
      return;
    }

    if (document.getElementById('oadub-floating-root')) {
      return;
    }

    floatingRootEl = document.createElement('div');
    floatingRootEl.id = 'oadub-floating-root';
    floatingRootEl.style.position = 'fixed';
    floatingRootEl.style.zIndex = '2147483647';
    floatingRootEl.style.bottom = '24px';
    floatingRootEl.style.right = '24px';
    floatingRootEl.style.width = 'auto';
    floatingRootEl.style.height = 'auto';
    floatingRootEl.style.pointerEvents = 'none';

    shadowRoot = floatingRootEl.attachShadow({ mode: 'open' });

    // Styles inside Shadow DOM
    const style = document.createElement('style');
    style.textContent = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
        user-select: none;
      }

      .oadub-container {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 10px;
        pointer-events: auto;
      }

      /* Floating Badge (Collapsed State) */
      .oadub-badge {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(10, 14, 23, 0.85);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(56, 189, 248, 0.35);
        box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.45), 0 0 14px rgba(56, 189, 248, 0.2);
        color: #f8fafc;
        padding: 8px 14px;
        border-radius: 30px;
        font-size: 13px;
        font-weight: 700;
        cursor: grab;
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s ease, border-color 0.2s ease;
      }

      .oadub-badge:active {
        cursor: grabbing;
      }

      .oadub-badge:hover {
        transform: translateY(-2px) scale(1.03);
        border-color: rgba(56, 189, 248, 0.65);
        box-shadow: 0 10px 36px 0 rgba(0, 0, 0, 0.55), 0 0 20px rgba(56, 189, 248, 0.35);
      }

      .badge-icon {
        font-size: 15px;
        line-height: 1;
      }

      .badge-title {
        background: linear-gradient(135deg, #ffffff 0%, #38bdf8 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        letter-spacing: -0.2px;
      }

      .badge-status-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #94a3b8;
        transition: all 0.3s ease;
      }

      .badge-status-dot.active {
        background: #10b981;
        box-shadow: 0 0 8px #10b981;
        animation: pulseDot 1.5s infinite;
      }

      .badge-status-dot.connecting {
        background: #f59e0b;
        box-shadow: 0 0 8px #f59e0b;
      }

      @keyframes pulseDot {
        0% { transform: scale(0.9); opacity: 0.8; }
        50% { transform: scale(1.25); opacity: 1; }
        100% { transform: scale(0.9); opacity: 0.8; }
      }

      /* Floating Mini Control Panel */
      .oadub-panel {
        width: 290px;
        background: rgba(10, 14, 23, 0.92);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 14px;
        padding: 12px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), 0 0 24px rgba(56, 189, 248, 0.15);
        color: #f8fafc;
        display: flex;
        flex-direction: column;
        gap: 10px;
        animation: panelSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .oadub-panel.hidden {
        display: none !important;
      }

      @keyframes panelSlideUp {
        from {
          opacity: 0;
          transform: translateY(12px) scale(0.96);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }

      .panel-brand {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 700;
        color: #ffffff;
      }

      .panel-brand-badge {
        font-size: 8px;
        font-weight: 800;
        color: #38bdf8;
        background: rgba(56, 189, 248, 0.15);
        border: 1px solid rgba(56, 189, 248, 0.35);
        padding: 1px 4px;
        border-radius: 3px;
      }

      .panel-close-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        font-size: 14px;
        padding: 2px 6px;
        border-radius: 4px;
        transition: all 0.15s ease;
      }

      .panel-close-btn:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.1);
      }

      /* Status Display */
      .panel-status-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        color: #94a3b8;
      }

      .panel-status-badge {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 10px;
        font-weight: 600;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .panel-status-badge.active {
        background: rgba(16, 185, 129, 0.15);
        border-color: rgba(16, 185, 129, 0.35);
        color: #34d399;
      }

      .panel-status-badge.connecting {
        background: rgba(245, 158, 11, 0.15);
        border-color: rgba(245, 158, 11, 0.35);
        color: #fbbf24;
      }

      .panel-status-badge.error {
        background: rgba(244, 63, 94, 0.15);
        border-color: rgba(244, 63, 94, 0.35);
        color: #fb7185;
      }

      /* Action Button */
      .btn-hub-action {
        width: 100%;
        padding: 8px 12px;
        background: linear-gradient(135deg, #38bdf8 0%, #6366f1 100%);
        border: none;
        border-radius: 8px;
        color: #ffffff;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.2s ease;
        box-shadow: 0 4px 14px rgba(56, 189, 248, 0.3);
      }

      .btn-hub-action:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 18px rgba(56, 189, 248, 0.45);
      }

      .btn-hub-action.stop-mode {
        background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%);
        box-shadow: 0 4px 14px rgba(244, 63, 94, 0.3);
      }

      .btn-hub-action.stop-mode:hover {
        box-shadow: 0 6px 18px rgba(244, 63, 94, 0.45);
      }

      /* Volume Sliders */
      .hub-slider-group {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .hub-slider-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 10px;
        color: #94a3b8;
        font-weight: 500;
      }

      .hub-slider-label.accent {
        color: #38bdf8;
      }

      .hub-range {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 4px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.15);
        outline: none;
        cursor: pointer;
      }

      .hub-range::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #94a3b8;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .hub-range.accent::-webkit-slider-thumb {
        background: #38bdf8;
        box-shadow: 0 0 6px rgba(56, 189, 248, 0.6);
      }

      .hub-actions-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 2px;
      }

      .btn-hub-mini {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 5px 8px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        color: #bae6fd;
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .btn-hub-mini:hover {
        background: rgba(56, 189, 248, 0.18);
        border-color: rgba(56, 189, 248, 0.4);
        color: #ffffff;
      }

      .btn-hub-mini.btn-hub-hide-site {
        color: #fca5a5;
        border-color: rgba(244, 63, 94, 0.25);
      }

      .btn-hub-mini.btn-hub-hide-site:hover {
        background: rgba(244, 63, 94, 0.2);
        border-color: rgba(244, 63, 94, 0.5);
        color: #ffffff;
      }
    `;

    shadowRoot.appendChild(style);

    const container = document.createElement('div');
    container.className = 'oadub-container';

    // 1. Badge HTML
    const badge = document.createElement('div');
    badge.className = 'oadub-badge';
    badge.title = 'oaDub Simültane Çeviri Hub';
    badge.innerHTML = `
      <span class="badge-icon">🎙️</span>
      <span class="badge-title">oaDub</span>
      <span class="badge-status-dot" id="badgeDot"></span>
    `;

    // 2. Control Panel HTML
    const panel = document.createElement('div');
    panel.className = 'oadub-panel hidden';
    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-brand">
          <span>🎙️ oaDub Live</span>
          <span class="panel-brand-badge">HUB</span>
        </div>
        <button type="button" class="panel-close-btn" id="closePanelBtn" title="Kapat">✕</button>
      </div>

      <div class="panel-status-row">
        <span>Durum:</span>
        <div class="panel-status-badge" id="panelStatusBadge">
          <span id="panelStatusText">Hazır</span>
        </div>
      </div>

      <button type="button" class="btn-hub-action" id="hubToggleTranslateBtn">
        <span>▶️ Simültane Çeviriyi Başlat</span>
      </button>

      <div class="hub-slider-group">
        <div class="hub-slider-label">
          <span>🔊 Orijinal Ses</span>
          <span id="hubOrigVal">20%</span>
        </div>
        <input type="range" class="hub-range" id="hubOrigSlider" min="0" max="100" value="20">
      </div>

      <div class="hub-slider-group">
        <div class="hub-slider-label accent">
          <span>🎙️ Dublaj Sesi</span>
          <span id="hubTransVal">100%</span>
        </div>
        <input type="range" class="hub-range accent" id="hubTransSlider" min="0" max="100" value="100">
      </div>

      <div class="hub-actions-row">
        <button type="button" class="btn-hub-mini" id="hubDownloadBtn" title="Kaydedilen Dublaj Sesini İndir">
          <span>📥 Dublaj (.wav)</span>
        </button>
        <button type="button" class="btn-hub-mini btn-hub-hide-site" id="hubHideForSiteBtn" title="Bu web sitesinde yüzen butonu gizle">
          <span>🚫 Bu Sitede Gizle</span>
        </button>
      </div>
    `;

    container.appendChild(panel);
    container.appendChild(badge);
    shadowRoot.appendChild(container);

    document.documentElement.appendChild(floatingRootEl);

    // Cache elements
    floatingBadge = badge;
    floatingPanel = panel;
    floatingToggleBtn = shadowRoot.getElementById('hubToggleTranslateBtn');
    floatingOriginalSlider = shadowRoot.getElementById('hubOrigSlider');
    floatingOrigVal = shadowRoot.getElementById('hubOrigVal');
    floatingTranslatedSlider = shadowRoot.getElementById('hubTransSlider');
    floatingTransVal = shadowRoot.getElementById('hubTransVal');
    floatingDownloadBtn = shadowRoot.getElementById('hubDownloadBtn');
    floatingHideSiteBtn = shadowRoot.getElementById('hubHideForSiteBtn');
    floatingStatusBadge = shadowRoot.getElementById('panelStatusBadge');
    floatingStatusText = shadowRoot.getElementById('panelStatusText');

    setupFloatingHubInteractions();
    syncInitialSettings();
  }

  function clampAndApplyPosition(pos) {
    if (!floatingRootEl) return;
    const right = (pos && typeof pos.right === 'number') ? pos.right : 24;
    const bottom = (pos && typeof pos.bottom === 'number') ? pos.bottom : 24;

    const clampedRight = Math.max(10, Math.min(window.innerWidth - 80, right));
    const clampedBottom = Math.max(10, Math.min(window.innerHeight - 80, bottom));

    floatingRootEl.style.right = `${clampedRight}px`;
    floatingRootEl.style.bottom = `${clampedBottom}px`;
  }

  function setupFloatingHubInteractions() {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialRight = 24;
    let initialBottom = 24;
    let currentRight = 24;
    let currentBottom = 24;
    let hasMoved = false;

    // Toggle panel on badge click if not dragged
    floatingBadge.addEventListener('mousedown', (e) => {
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      
      const rect = floatingRootEl.getBoundingClientRect();
      initialRight = window.innerWidth - rect.right;
      initialBottom = window.innerHeight - rect.bottom;
      currentRight = initialRight;
      currentBottom = initialBottom;
      
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaX = startX - e.clientX;
      const deltaY = startY - e.clientY;

      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        hasMoved = true;
      }

      currentRight = Math.max(10, Math.min(window.innerWidth - 80, initialRight + deltaX));
      currentBottom = Math.max(10, Math.min(window.innerHeight - 80, initialBottom + deltaY));

      floatingRootEl.style.right = `${currentRight}px`;
      floatingRootEl.style.bottom = `${currentBottom}px`;
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        if (hasMoved) {
          chrome.storage.local.set({
            floatingPosition: { right: currentRight, bottom: currentBottom }
          });
        } else {
          toggleFloatingPanel();
        }
      }
    });

    // Window resize listener to keep button in viewport
    window.addEventListener('resize', () => {
      chrome.storage.local.get(['floatingPosition'], (stored) => {
        clampAndApplyPosition(stored.floatingPosition);
      });
    });

    // Close button
    const closeBtn = shadowRoot.getElementById('closePanelBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFloatingPanel(false);
      });
    }

    // Hide for this site button
    if (floatingHideSiteBtn) {
      floatingHideSiteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const hostname = window.location.hostname;
        if (!hostname) return;

        chrome.storage.local.get(['disabledDomains'], (res) => {
          const list = Array.isArray(res.disabledDomains) ? [...res.disabledDomains] : [];
          if (!list.includes(hostname)) {
            list.push(hostname);
          }
          // Also check clean root domain (e.g., youtube.com for www.youtube.com)
          const rootDomain = hostname.replace(/^www\./, '');
          if (rootDomain && !list.includes(rootDomain)) {
            list.push(rootDomain);
          }

          chrome.storage.local.set({ disabledDomains: list }, () => {
            toggleFloatingPanel(false);
            if (floatingRootEl) {
              floatingRootEl.style.setProperty('display', 'none', 'important');
            }
          });
        });
      });
    }

    // Toggle Translate Action (Start / Stop)
    if (floatingToggleBtn) {
      floatingToggleBtn.addEventListener('click', () => {
        if (!isTranslating) {
          updateHubStatus('connecting');
          safeSendMessage({ action: 'START_TRANSLATION_FROM_PAGE' }, (resp) => {
            if (resp && resp.success) {
              isTranslating = true;
              updateHubStatus('translating');
            } else {
              updateHubStatus('error', resp ? resp.error : 'Başlatılamadı');
            }
          });
        } else {
          updateHubStatus('idle');
          safeSendMessage({ action: 'STOP_TRANSLATION_FROM_PAGE' }, () => {
            isTranslating = false;
            updateHubStatus('idle');
          });
        }
      });
    }

    // Original Volume Slider
    if (floatingOriginalSlider) {
      floatingOriginalSlider.addEventListener('input', () => {
        const val = parseInt(floatingOriginalSlider.value, 10);
        if (floatingOrigVal) floatingOrigVal.textContent = `${val}%`;
        const floatVal = val / 100;
        currentOriginalVolume = floatVal;
        chrome.storage.local.set({ tabOriginalVolume: floatVal });
        safeSendMessage({
          action: 'UPDATE_VOLUMES',
          tabOriginalVolume: floatVal,
          translatedVolume: currentTranslatedVolume
        });
      });
    }

    // Translated Volume Slider
    if (floatingTranslatedSlider) {
      floatingTranslatedSlider.addEventListener('input', () => {
        const val = parseInt(floatingTranslatedSlider.value, 10);
        if (floatingTransVal) floatingTransVal.textContent = `${val}%`;
        const floatVal = val / 100;
        currentTranslatedVolume = floatVal;
        chrome.storage.local.set({ translatedVolume: floatVal });
        safeSendMessage({
          action: 'UPDATE_VOLUMES',
          tabOriginalVolume: currentOriginalVolume,
          translatedVolume: floatVal
        });
      });
    }

    // Download Audio Action
    if (floatingDownloadBtn) {
      floatingDownloadBtn.addEventListener('click', async () => {
        try {
          const btnSpan = floatingDownloadBtn.querySelector('span');
          const originalText = btnSpan ? btnSpan.textContent : '📥 Dublaj (.wav)';
          if (btnSpan) btnSpan.textContent = 'Hazırlanıyor...';

          safeSendMessage({ action: 'GET_RECORDED_AUDIO' }, (resp) => {
            if (resp && resp.success && resp.dataUrl && resp.durationSeconds > 0) {
              const a = document.createElement('a');
              a.href = resp.dataUrl;
              a.download = `oaDub_Dublaj_${Date.now()}.wav`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);

              if (btnSpan) {
                btnSpan.textContent = 'İndirildi! 🔊';
                setTimeout(() => {
                  btnSpan.textContent = originalText;
                }, 1500);
              }
            } else {
              if (btnSpan) {
                btnSpan.textContent = 'Kayıt Yok!';
                setTimeout(() => {
                  btnSpan.textContent = originalText;
                }, 1500);
              }
            }
          });
        } catch (e) {
          console.warn('oaDub: Hub download error:', e);
        }
      });
    }
  }

  function isSiteDomainDisabled(disabledList, hostname) {
    if (!hostname || !Array.isArray(disabledList)) return false;
    const cleanHost = hostname.toLowerCase();
    return disabledList.some(d => {
      const cleanD = (d || '').toLowerCase();
      return cleanHost === cleanD || cleanHost.endsWith('.' + cleanD) || cleanD.endsWith('.' + cleanHost);
    });
  }

  function toggleFloatingPanel(force) {
    isPanelOpen = typeof force === 'boolean' ? force : !isPanelOpen;
    if (floatingPanel) {
      if (isPanelOpen) {
        floatingPanel.classList.remove('hidden');
        // Refresh live state immediately upon opening panel
        safeSendMessage({ action: 'GET_STATUS' }, (resp) => {
          if (resp && resp.success && resp.state) {
            updateHubStatus(resp.state.connectionStatus, resp.state.lastError);
            if (typeof resp.state.tabOriginalVolume === 'number') {
              updateVolumes(resp.state.tabOriginalVolume, resp.state.translatedVolume);
            }
          }
        });
      } else {
        floatingPanel.classList.add('hidden');
      }
    }
  }

  function updateHubStatus(status, errorMsg) {
    connectionStatus = status;
    const badgeDot = shadowRoot ? shadowRoot.getElementById('badgeDot') : null;

    if (badgeDot) {
      badgeDot.className = `badge-status-dot ${status === 'translating' || status === 'connected' ? 'active' : (status === 'connecting' ? 'connecting' : '')}`;
    }

    if (floatingStatusBadge && floatingStatusText) {
      floatingStatusBadge.className = `panel-status-badge ${status === 'translating' || status === 'connected' ? 'active' : (status === 'connecting' ? 'connecting' : (status === 'error' ? 'error' : ''))}`;
      
      switch (status) {
        case 'translating':
        case 'connected':
          floatingStatusText.textContent = 'Çeviriyor & Seslendiriyor';
          isTranslating = true;
          if (floatingToggleBtn) {
            floatingToggleBtn.className = 'btn-hub-action stop-mode';
            floatingToggleBtn.innerHTML = `<span>⏹️ Simültane Çeviriyi Durdur</span>`;
          }
          break;
        case 'connecting':
          floatingStatusText.textContent = 'Bağlanıyor...';
          if (floatingToggleBtn) {
            floatingToggleBtn.className = 'btn-hub-action';
            floatingToggleBtn.innerHTML = `<span>⏳ Bağlanıyor...</span>`;
          }
          break;
        case 'error':
          floatingStatusText.textContent = errorMsg ? `Hata: ${errorMsg}` : 'Bağlantı Hatası';
          isTranslating = false;
          if (floatingToggleBtn) {
            floatingToggleBtn.className = 'btn-hub-action';
            floatingToggleBtn.innerHTML = `<span>▶️ Tekrar Dene</span>`;
          }
          break;
        case 'idle':
        default:
          floatingStatusText.textContent = 'Hazır';
          isTranslating = false;
          if (floatingToggleBtn) {
            floatingToggleBtn.className = 'btn-hub-action';
            floatingToggleBtn.innerHTML = `<span>▶️ Simültane Çeviriyi Başlat</span>`;
          }
          break;
      }
    }
  }

  function syncInitialSettings() {
    chrome.storage.local.get([
      'showFloatingWidget',
      'tabOriginalVolume',
      'translatedVolume',
      'disabledDomains',
      'floatingPosition'
    ], (stored) => {
      const isCurrentSiteDisabled = isSiteDomainDisabled(stored.disabledDomains, window.location.hostname);
      showFloatingWidget = typeof stored.showFloatingWidget === 'boolean' ? stored.showFloatingWidget : false;

      if (floatingRootEl) {
        if (!showFloatingWidget || isCurrentSiteDisabled) {
          floatingRootEl.style.display = 'none';
        } else {
          floatingRootEl.style.display = 'block';
        }

        if (stored.floatingPosition) {
          clampAndApplyPosition(stored.floatingPosition);
        }
      }

      if (typeof stored.tabOriginalVolume === 'number') {
        currentOriginalVolume = stored.tabOriginalVolume;
        if (floatingOriginalSlider) floatingOriginalSlider.value = Math.round(currentOriginalVolume * 100);
        if (floatingOrigVal) floatingOrigVal.textContent = `${Math.round(currentOriginalVolume * 100)}%`;
      }

      if (typeof stored.translatedVolume === 'number') {
        currentTranslatedVolume = stored.translatedVolume;
        if (floatingTranslatedSlider) floatingTranslatedSlider.value = Math.round(currentTranslatedVolume * 100);
        if (floatingTransVal) floatingTransVal.textContent = `${Math.round(currentTranslatedVolume * 100)}%`;
      }
    });

    safeSendMessage({ action: 'GET_STATUS' }, (resp) => {
      if (resp && resp.success && resp.state) {
        if (resp.state.connectionStatus) {
          updateHubStatus(resp.state.connectionStatus, resp.state.lastError);
        }
      }
    });
  }

  // Listen for storage changes dynamically (e.g. showFloatingWidget toggle in popup or position updates)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.showFloatingWidget || changes.disabledDomains) {
        chrome.storage.local.get(['showFloatingWidget', 'disabledDomains'], (stored) => {
          const isCurrentSiteDisabled = isSiteDomainDisabled(stored.disabledDomains, window.location.hostname);
          showFloatingWidget = typeof stored.showFloatingWidget === 'boolean' ? stored.showFloatingWidget : false;

          if (floatingRootEl) {
            if (!showFloatingWidget || isCurrentSiteDisabled) {
              floatingRootEl.style.display = 'none';
            } else {
              floatingRootEl.style.display = 'block';
              // Refresh status when shown
              safeSendMessage({ action: 'GET_STATUS' }, (resp) => {
                if (resp && resp.success && resp.state) {
                  updateHubStatus(resp.state.connectionStatus, resp.state.lastError);
                }
              });
            }
          }
        });
      }
      if (changes.floatingPosition && changes.floatingPosition.newValue) {
        clampAndApplyPosition(changes.floatingPosition.newValue);
      }
      if (changes.tabOriginalVolume && typeof changes.tabOriginalVolume.newValue === 'number') {
        updateVolumes(changes.tabOriginalVolume.newValue, currentTranslatedVolume);
      }
      if (changes.translatedVolume && typeof changes.translatedVolume.newValue === 'number') {
        updateVolumes(currentOriginalVolume, changes.translatedVolume.newValue);
      }
    }
  });

  // =========================================================================
  // RUNTIME MESSAGE LISTENER
  // =========================================================================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'START_DOM_CAPTURE': {
        startDomCapture(request)
          .then(() => {
            checkAndNotifyMediaStatus();
            sendResponse({ success: true, isCapturing: true });
          })
          .catch((err) => {
            sendResponse({ success: false, error: err.message });
          });
        return true;
      }

      case 'STOP_DOM_CAPTURE': {
        stopDomCapture()
          .then(() => sendResponse({ success: true, isCapturing: false }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
      }

      case 'GET_MEDIA_STATUS': {
        scanAndTrackMediaElements();
        const medias = Array.from(trackedMediaElements).filter((m) => document.contains(m));
        let hasPlaying = false;
        let isMuted = false;

        for (const media of medias) {
          if (!media.paused && !media.ended) {
            hasPlaying = true;
            if (media.muted || media.volume === 0) isMuted = true;
            break;
          }
        }
        sendResponse({
          success: true,
          hasMedia: medias.length > 0,
          hasPlaying: hasPlaying,
          isMuted: isMuted,
          count: medias.length
        });
        return true;
      }

      case 'UNMUTE_ACTIVE_MEDIA': {
        unmuteActiveMedia();
        sendResponse({ success: true });
        return true;
      }

      case 'PLAY_AUDIO_CHUNK': {
        if (request.audioData) {
          playAudioChunk(request.audioData).catch(() => {});
        }
        sendResponse({ success: true });
        return true;
      }

      case 'UPDATE_DOM_VOLUMES':
      case 'UPDATE_VOLUMES': {
        updateVolumes(request.tabOriginalVolume, request.translatedVolume);
        sendResponse({ success: true });
        return true;
      }

      case 'CONNECTION_STATUS': {
        updateHubStatus(request.status, request.error);
        sendResponse({ success: true });
        return true;
      }

      case 'AUDIO_ERROR': {
        updateHubStatus('error', request.error);
        sendResponse({ success: true });
        return true;
      }

      case 'TRANSCRIPT_UPDATE': {
        sendResponse({ success: true });
        return true;
      }

      case 'GET_RECORDED_AUDIO': {
        let totalSamples = 0;
        for (const chunk of recordedChunks) {
          totalSamples += chunk.length;
        }
        const durationSeconds = totalSamples / 24000;

        if (recordedChunks.length === 0 || totalSamples === 0) {
          sendResponse({
            success: true,
            dataUrl: null,
            durationSeconds: 0,
            totalSamples: 0
          });
        } else {
          const wavBuffer = encodeWAV(recordedChunks, 24000);
          const base64Wav = arrayBufferToBase64(wavBuffer);
          const dataUrl = 'data:audio/wav;base64,' + base64Wav;
          sendResponse({
            success: true,
            dataUrl: dataUrl,
            durationSeconds: durationSeconds,
            totalSamples: totalSamples
          });
        }
        return true;
      }

      case 'CLEAR_RECORDED_AUDIO': {
        recordedChunks = [];
        sendResponse({ success: true });
        return true;
      }

      default:
        break;
    }
  });

  // Initialize DOM tracking & Floating Hub
  scanAndTrackMediaElements();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFloatingHub);
  } else {
    initFloatingHub();
  }
})();
