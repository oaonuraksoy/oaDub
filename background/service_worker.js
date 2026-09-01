/**
 * oaDub - Background Service Worker
 * Handles hybrid audio capture lifecycle (tabCapture + offscreen or content script DOM capture),
 * Gemini Live WebSocket management, and state synchronization across popup and tabs.
 */

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

// Global state in service worker memory
const state = {
  isTranslating: false,
  activeTabId: null,
  activeTabTitle: '',
  targetLanguage: 'tr',
  model: 'models/gemini-3.5-live-translate-preview',
  tabOriginalVolume: 0.2,
  translatedVolume: 1.0,
  connectionStatus: 'idle', // 'idle' | 'connecting' | 'connected' | 'translating' | 'error'
  lastError: null,
  transcripts: [],
  captureMode: 'tab', // 'tab' (tabCapture + offscreen) | 'dom' (content_script DOM capture)
  isMediaMuted: false,
  hasActiveMedia: false
};

/**
 * Checks if tabCapture API is supported in current browser environment.
 */
function hasTabCaptureSupport() {
  return typeof chrome.tabCapture !== 'undefined' && typeof chrome.tabCapture.getMediaStreamId === 'function';
}

/**
 * Checks if offscreen API is supported in current browser environment.
 */
function hasOffscreenSupport() {
  return typeof chrome.offscreen !== 'undefined' && typeof chrome.offscreen.createDocument === 'function';
}

/**
 * Updates extension action badge based on current connection status.
 */
function updateBadge(status) {
  try {
    switch (status) {
      case 'translating':
        chrome.action.setBadgeText({ text: 'LIVE' });
        chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
        break;
      case 'connected':
        chrome.action.setBadgeText({ text: 'ON' });
        chrome.action.setBadgeBackgroundColor({ color: '#38bdf8' });
        break;
      case 'connecting':
        chrome.action.setBadgeText({ text: '...' });
        chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
        break;
      case 'error':
        chrome.action.setBadgeText({ text: 'ERR' });
        chrome.action.setBadgeBackgroundColor({ color: '#f43f5e' });
        break;
      case 'idle':
      default:
        chrome.action.setBadgeText({ text: '' });
        break;
    }
  } catch (e) {
    // Ignore badge errors if action is not yet ready
  }
}

/**
 * Creates the offscreen document if it doesn't already exist.
 */
async function createOffscreenDocument() {
  if (!hasOffscreenSupport()) {
    return;
  }

  if (await hasOffscreenDocument()) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [
      chrome.offscreen.Reason.AUDIO_PLAYBACK,
      chrome.offscreen.Reason.USER_MEDIA
    ],
    justification: 'Capture tab audio stream and process live bi-directional translation with Gemini Live API'
  });
}

/**
 * Checks if the offscreen document is currently active.
 */
async function hasOffscreenDocument() {
  if (!hasOffscreenSupport()) {
    return false;
  }

  if ('getContexts' in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });
    return contexts.length > 0;
  }
  
  if (chrome.offscreen && typeof chrome.offscreen.hasDocument === 'function') {
    return await chrome.offscreen.hasDocument();
  }

  return false;
}

/**
 * Safely closes the offscreen document.
 */
async function closeOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    try {
      await chrome.offscreen.closeDocument();
    } catch (err) {
      console.warn('oaDub: Error closing offscreen document:', err);
    }
  }
}

/**
 * Safely sends a message to content script in a given tab, injecting it if necessary.
 */
async function sendToContentScript(tabId, message) {
  if (!tabId) return;
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // If content script was not already loaded (e.g. tab opened before extension installed)
    if (chrome.scripting && chrome.scripting.executeScript) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId, allFrames: true },
          files: ['scripts/content_script.js']
        });
        return await chrome.tabs.sendMessage(tabId, message);
      } catch (injectErr) {
        console.warn('oaDub: Script injection fallback error:', injectErr);
      }
    }
  }
}

/**
 * Broadcasts a message to the active content script tab and all open popup views.
 */
function broadcastToTabsAndPopup(message) {
  // 1. Send directly to active tab content script
  if (state.activeTabId) {
    chrome.tabs.sendMessage(state.activeTabId, message).catch(() => {});
  }
  // 2. Also broadcast to all active tabs in all windows for multi-window sync
  try {
    chrome.tabs.query({ active: true }, (tabs) => {
      if (tabs && Array.isArray(tabs)) {
        tabs.forEach((t) => {
          if (t.id && t.id !== state.activeTabId) {
            chrome.tabs.sendMessage(t.id, message).catch(() => {});
          }
        });
      }
    });
  } catch (e) {}

  // 3. Broadcast to popup views and offscreen document
  chrome.runtime.sendMessage(message).catch(() => {});
}

// Runtime Message Dispatcher
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handleMessage = async () => {
    switch (request.action) {
      case 'START_TRANSLATION_FROM_PAGE':
      case 'START_TRANSLATION': {
        try {
          let tabId = request.tabId;
          if (!tabId && sender.tab && sender.tab.id) {
            tabId = sender.tab.id;
          }
          if (!tabId) {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs && tabs.length > 0) {
              tabId = tabs[0].id;
            }
          }
          if (!tabId) {
            throw new Error('Geçerli bir sekme ID bulunamadı.');
          }

          // Fetch stored settings if not provided in message
          const stored = await chrome.storage.local.get([
            'apiKey',
            'targetLanguage',
            'model',
            'tabOriginalVolume',
            'translatedVolume'
          ]);

          const apiKey = (request.apiKey || stored.apiKey || '').trim().replace(/^["']|["']$/g, '');
          if (!apiKey) {
            throw new Error('Lütfen önce oaDub popup penceresinden geçerli bir Gemini API anahtarı kaydediniz.');
          }

          const targetLang = request.targetLanguage || stored.targetLanguage || 'tr';
          const selectedModel = request.model || stored.model || 'models/gemini-3.5-live-translate-preview';
          const tabVol = typeof request.tabOriginalVolume === 'number' ? request.tabOriginalVolume : (typeof stored.tabOriginalVolume === 'number' ? stored.tabOriginalVolume : 0.2);
          const transVol = typeof request.translatedVolume === 'number' ? request.translatedVolume : (typeof stored.translatedVolume === 'number' ? stored.translatedVolume : 1.0);

          let chosenMode = 'tab';
          let streamId = null;

          // 1. Determine environment capabilities (Desktop tabCapture vs Mobile/SPA DOM capture)
          if (hasTabCaptureSupport()) {
            try {
              streamId = await chrome.tabCapture.getMediaStreamId({
                targetTabId: tabId
              });
            } catch (err) {
              console.warn('oaDub: tabCapture.getMediaStreamId failed, switching to DOM Media Capture mode:', err);
              chosenMode = 'dom';
            }
          } else {
            chosenMode = 'dom';
          }

          if (!streamId) {
            chosenMode = 'dom';
          }

          // Update local state
          state.captureMode = chosenMode;
          state.isTranslating = true;
          state.translationStartTime = Date.now();
          state.activeTabId = tabId;
          state.targetLanguage = targetLang;
          state.model = selectedModel;
          state.tabOriginalVolume = tabVol;
          state.translatedVolume = transVol;
          state.connectionStatus = 'connecting';
          state.lastError = null;
          updateBadge('connecting');
          broadcastToTabsAndPopup({ action: 'CONNECTION_STATUS', status: 'connecting' });

          // 2. Setup Offscreen Audio Processor & WebSocket (if offscreen supported)
          if (hasOffscreenSupport()) {
            await createOffscreenDocument();
            await chrome.runtime.sendMessage({
              action: 'START_RECORDING',
              captureMode: chosenMode,
              streamId: streamId,
              apiKey: apiKey,
              targetLanguage: state.targetLanguage,
              model: state.model,
              tabOriginalVolume: state.tabOriginalVolume,
              translatedVolume: state.translatedVolume
            });
          }

          // 3. If DOM capture mode, trigger content script capture
          if (chosenMode === 'dom') {
            try {
              await sendToContentScript(tabId, {
                action: 'START_DOM_CAPTURE',
                tabOriginalVolume: state.tabOriginalVolume,
                translatedVolume: state.translatedVolume
              });
            } catch (domErr) {
              console.warn('oaDub: Could not initialize DOM capture on tab:', domErr);
            }
          }

          return { success: true, state };
        } catch (error) {
          console.error('oaDub: START_TRANSLATION Error:', error);
          state.isTranslating = false;
          state.connectionStatus = 'error';
          state.lastError = error.message || 'Bilinmeyen bir hata oluştu';
          updateBadge('error');
          broadcastToTabsAndPopup({ action: 'CONNECTION_STATUS', status: 'error', error: state.lastError });
          return { success: false, error: state.lastError, state };
        }
      }

      case 'STOP_TRANSLATION_FROM_PAGE':
      case 'STOP_TRANSLATION': {
        try {
          if (await hasOffscreenDocument()) {
            await chrome.runtime.sendMessage({ action: 'STOP_RECORDING' }).catch(() => {});
          }
          if (state.activeTabId) {
            chrome.tabs.sendMessage(state.activeTabId, { action: 'STOP_DOM_CAPTURE' }).catch(() => {});
          }
          state.isTranslating = false;
          state.connectionStatus = 'idle';
          updateBadge('idle');
          broadcastToTabsAndPopup({ action: 'CONNECTION_STATUS', status: 'idle' });
          return { success: true, state };
        } catch (error) {
          console.error('oaDub: STOP_TRANSLATION Error:', error);
          state.isTranslating = false;
          state.connectionStatus = 'idle';
          updateBadge('idle');
          broadcastToTabsAndPopup({ action: 'CONNECTION_STATUS', status: 'idle' });
          return { success: true, state };
        }
      }

      case 'GET_STATUS': {
        return { success: true, state };
      }

      case 'UPDATE_VOLUMES': {
        if (typeof request.tabOriginalVolume === 'number') {
          state.tabOriginalVolume = request.tabOriginalVolume;
        }
        if (typeof request.translatedVolume === 'number') {
          state.translatedVolume = request.translatedVolume;
        }
        
        if (await hasOffscreenDocument()) {
          chrome.runtime.sendMessage({
            action: 'UPDATE_VOLUMES',
            tabOriginalVolume: state.tabOriginalVolume,
            translatedVolume: state.translatedVolume
          }).catch(() => {});
        }

        if (state.activeTabId) {
          chrome.tabs.sendMessage(state.activeTabId, {
            action: 'UPDATE_DOM_VOLUMES',
            tabOriginalVolume: state.tabOriginalVolume,
            translatedVolume: state.translatedVolume
          }).catch(() => {});
        }

        return { success: true, state };
      }

      case 'DOM_PCM_CHUNK': {
        // Forward PCM chunk from content script to offscreen WebSocket processor
        if (state.isTranslating && (await hasOffscreenDocument())) {
          chrome.runtime.sendMessage({
            action: 'INJECT_PCM_CHUNK',
            pcmChunk: request.pcmChunk
          }).catch(() => {});
        }
        return { success: true };
      }

      case 'MEDIA_MUTED_STATUS': {
        state.isMediaMuted = Boolean(request.isMuted);
        if (typeof request.hasActiveMedia === 'boolean') {
          state.hasActiveMedia = request.hasActiveMedia;
        }
        return { success: true };
      }

      case 'UNMUTE_PAGE_MEDIA': {
        if (state.activeTabId) {
          chrome.tabs.sendMessage(state.activeTabId, { action: 'UNMUTE_ACTIVE_MEDIA' }).catch(() => {});
        }
        return { success: true };
      }

      case 'CONNECTION_STATUS': {
        state.connectionStatus = request.status;
        if (request.status === 'error' && request.error) {
          state.lastError = request.error;
          state.isTranslating = false;
        } else if (request.status === 'translating' || request.status === 'connected') {
          state.isTranslating = true;
          state.lastError = null;
        } else if (request.status === 'idle') {
          state.isTranslating = false;
        }
        updateBadge(request.status);
        broadcastToTabsAndPopup({
          action: 'CONNECTION_STATUS',
          status: request.status,
          error: request.error
        });
        return { success: true };
      }

      case 'AUDIO_ERROR': {
        state.connectionStatus = 'error';
        state.lastError = request.error;
        state.isTranslating = false;
        updateBadge('error');
        broadcastToTabsAndPopup({
          action: 'AUDIO_ERROR',
          error: request.error
        });
        return { success: true };
      }

      case 'TRANSCRIPT_UPDATE': {
        if (request.text) {
          const elapsedMs = state.translationStartTime ? Math.max(0, Date.now() - state.translationStartTime) : 0;
          const item = {
            id: Date.now() + Math.random().toString(36).substring(2, 6),
            text: request.text,
            timestamp: new Date().toLocaleTimeString(),
            elapsedSec: Math.round(elapsedMs / 100) / 10
          };
          state.transcripts.push(item);
          // Keep last 100 entries to prevent memory leak
          if (state.transcripts.length > 100) {
            state.transcripts.shift();
          }
          // Broadcast to content script so floating subtitle overlay updates
          broadcastToTabsAndPopup({
            action: 'TRANSCRIPT_UPDATE',
            text: request.text,
            elapsedSec: item.elapsedSec
          });
        }
        return { success: true };
      }

      case 'CLEAR_TRANSCRIPTS': {
        state.transcripts = [];
        return { success: true };
      }

      case 'GET_RECORDED_AUDIO': {
        try {
          let audioResult = { success: true, dataUrl: null, durationSeconds: 0, totalSamples: 0 };
          if (await hasOffscreenDocument()) {
            audioResult = await chrome.runtime.sendMessage({ action: 'GET_RECORDED_AUDIO' });
          } else if (state.captureMode === 'dom' && state.activeTabId) {
            audioResult = await chrome.tabs.sendMessage(state.activeTabId, { action: 'GET_RECORDED_AUDIO' });
          }
          return audioResult || { success: true, dataUrl: null, durationSeconds: 0, totalSamples: 0 };
        } catch (err) {
          console.warn('oaDub: Error fetching recorded audio:', err);
          return { success: true, dataUrl: null, durationSeconds: 0, totalSamples: 0 };
        }
      }

      case 'CLEAR_RECORDED_AUDIO': {
        try {
          if (await hasOffscreenDocument()) {
            await chrome.runtime.sendMessage({ action: 'CLEAR_RECORDED_AUDIO' }).catch(() => {});
          }
          if (state.activeTabId) {
            await chrome.tabs.sendMessage(state.activeTabId, { action: 'CLEAR_RECORDED_AUDIO' }).catch(() => {});
          }
          return { success: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      default:
        return { success: false, error: 'Unknown action' };
    }
  };

  handleMessage().then(sendResponse);
  return true; // Keep message channel open for async response
});

// Global Keyboard Command Listener (Alt+Shift+D)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-translation') {
    if (state.isTranslating) {
      // Stop translation
      chrome.runtime.sendMessage({ action: 'STOP_RECORDING' }).catch(() => {});
      if (state.activeTabId) {
        chrome.tabs.sendMessage(state.activeTabId, { action: 'STOP_DOM_CAPTURE' }).catch(() => {});
      }
      closeOffscreenDocument();
      state.isTranslating = false;
      state.connectionStatus = 'idle';
      state.translationStartTime = null;
      updateBadge('idle');
      broadcastToTabsAndPopup({
        action: 'CONNECTION_STATUS',
        status: 'idle'
      });
      chrome.runtime.sendMessage({
        action: 'CONNECTION_STATUS',
        status: 'idle'
      }).catch(() => {});
    } else {
      // Start translation on current active tab
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs.length > 0 && tabs[0].id) {
          const tab = tabs[0];
          const stored = await chrome.storage.local.get([
            'apiKey',
            'targetLanguage',
            'model',
            'tabOriginalVolume',
            'translatedVolume'
          ]);

          const apiKey = (stored.apiKey || '').trim().replace(/^["']|["']$/g, '');
          if (!apiKey) {
            console.warn('oaDub: Kısayol ile başlatılamadı: API Anahtarı eksik.');
            return;
          }

          state.translationStartTime = Date.now();
          // Message to self runtime
          const fakeRequest = {
            action: 'START_TRANSLATION',
            tabId: tab.id,
            apiKey: apiKey,
            targetLanguage: stored.targetLanguage || 'tr',
            model: stored.model || 'models/gemini-3.5-live-translate-preview',
            tabOriginalVolume: typeof stored.tabOriginalVolume === 'number' ? stored.tabOriginalVolume : 0.2,
            translatedVolume: typeof stored.translatedVolume === 'number' ? stored.translatedVolume : 1.0
          };

          // Trigger start directly via runtime message or direct call
          chrome.runtime.sendMessage(fakeRequest).catch(() => {});
        }
      } catch (err) {
        console.warn('oaDub: Hotkey start error:', err);
      }
    }
  }
});

// Re-hook DOM capture on SPA navigation (Instagram Reels, YouTube transitions, etc.)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (state.isTranslating && state.activeTabId === tabId && changeInfo.status === 'complete') {
    if (state.captureMode === 'dom') {
      sendToContentScript(tabId, {
        action: 'START_DOM_CAPTURE',
        tabOriginalVolume: state.tabOriginalVolume,
        translatedVolume: state.translatedVolume
      }).catch(() => {});
    }
  }
});

// Clean up when active tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.isTranslating && state.activeTabId === tabId) {
    chrome.runtime.sendMessage({ action: 'STOP_RECORDING' }).catch(() => {});
    state.isTranslating = false;
    state.connectionStatus = 'idle';
    state.translationStartTime = null;
    updateBadge('idle');
  }
});

// Auto-set default settings on install or update if not set
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const stored = await chrome.storage.local.get(['model']);
    if (!stored.model || stored.model.includes('2.0')) {
      await chrome.storage.local.set({ model: 'models/gemini-3.5-live-translate-preview' });
    }
  } catch (e) {
    console.warn('oaDub: Migration error on install:', e);
  }
});
