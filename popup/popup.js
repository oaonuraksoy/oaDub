/**
 * oaDub - Popup Controller Script
 * Manages user interface, live settings synchronization, hybrid audio capture commands,
 * muted media detection/unmute, and real-time transcript presentation.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Tab Navigation Elements
  const tabDubbingBtn = document.getElementById('tabDubbingBtn');
  const tabSettingsBtn = document.getElementById('tabSettingsBtn');
  const paneDubbing = document.getElementById('paneDubbing');
  const paneSettings = document.getElementById('paneSettings');
  const toggleGuideBtn = document.getElementById('toggleGuideBtn');
  const guideContent = document.getElementById('guideContent');

  // DOM Elements
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const tabCard = document.getElementById('tabCard');
  const tabFavicon = document.getElementById('tabFavicon');
  const tabTitle = document.getElementById('tabTitle');
  const captureModeTag = document.getElementById('captureModeTag');
  const mutedWarningBanner = document.getElementById('mutedWarningBanner');
  const unmuteMediaBtn = document.getElementById('unmuteMediaBtn');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleApiKeyBtn = document.getElementById('toggleApiKeyBtn');
  const eyeIcon = document.getElementById('eyeIcon');
  const keySavedTag = document.getElementById('keySavedTag');
  const apiKeyTypeBadge = document.getElementById('apiKeyTypeBadge');
  const targetLanguageSelect = document.getElementById('targetLanguageSelect');
  const showFloatingWidgetToggle = document.getElementById('showFloatingWidgetToggle');
  const currentDomainBadge = document.getElementById('currentDomainBadge');
  const siteControlDesc = document.getElementById('siteControlDesc');
  const toggleSiteVisibilityBtn = document.getElementById('toggleSiteVisibilityBtn');
  const toggleSiteVisibilityText = document.getElementById('toggleSiteVisibilityText');
  const originalVolSlider = document.getElementById('originalVolSlider');
  const originalVolLabel = document.getElementById('originalVolLabel');
  const translatedVolSlider = document.getElementById('translatedVolSlider');
  const translatedVolLabel = document.getElementById('translatedVolLabel');
  const toggleTranslateBtn = document.getElementById('toggleTranslateBtn');
  const btnText = document.getElementById('btnText');
  const playIcon = toggleTranslateBtn ? toggleTranslateBtn.querySelector('.play-icon') : null;
  const stopIcon = toggleTranslateBtn ? toggleTranslateBtn.querySelector('.stop-icon') : null;
  const pulseRecording = document.getElementById('pulseRecording');
  const recordedDurationBadge = document.getElementById('recordedDurationBadge');
  const downloadAudioBtn = document.getElementById('downloadAudioBtn');
  const downloadSrtBtn = document.getElementById('downloadSrtBtn');
  const downloadVttBtn = document.getElementById('downloadVttBtn');
  const downloadTranscriptBtn = document.getElementById('downloadTranscriptBtn');
  const transcriptPlaceholder = document.getElementById('transcriptPlaceholder');
  const transcriptStream = document.getElementById('transcriptStream');
  const transcriptContainer = document.getElementById('transcriptContainer');
  const copyTranscriptBtn = document.getElementById('copyTranscriptBtn');
  const clearTranscriptBtn = document.getElementById('clearTranscriptBtn');
  const errorBanner = document.getElementById('errorBanner');
  const errorMessage = document.getElementById('errorMessage');

  const DEFAULT_MODEL = 'models/gemini-3.5-live-translate-preview';

  let currentTab = null;
  let currentHostname = '';
  let disabledDomains = [];
  let isTranslating = false;
  let durationTimerInterval = null;
  let currentRecordedDuration = 0;

  // 1. Load active tab information
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs.length > 0) {
      currentTab = tabs[0];
      if (tabTitle) {
        tabTitle.textContent = currentTab.title || 'Sekme Başlığı Bulunamadı';
      }
      if (currentTab.favIconUrl && tabFavicon) {
        tabFavicon.src = currentTab.favIconUrl;
      }
      if (currentTab.url) {
        try {
          const urlObj = new URL(currentTab.url);
          if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
            currentHostname = urlObj.hostname;
          } else {
            currentHostname = urlObj.protocol.replace(':', '');
          }
        } catch (e) {
          currentHostname = '';
        }
      }
    } else if (tabTitle) {
      tabTitle.textContent = 'Aktif sekme tespit edilemedi';
    }
  } catch (err) {
    console.error('oaDub: Sekme bilgisi alınamadı:', err);
    if (tabTitle) {
      tabTitle.textContent = 'Sekme bilgisi alınamadı';
    }
  }

  // 2. Load stored settings & migration
  try {
    const stored = await chrome.storage.local.get([
      'apiKey',
      'targetLanguage',
      'model',
      'showFloatingWidget',
      'tabOriginalVolume',
      'translatedVolume',
      'disabledDomains'
    ]);

    if (stored.apiKey && apiKeyInput) {
      const cleanKey = stored.apiKey.trim().replace(/^["']|["']$/g, '');
      apiKeyInput.value = cleanKey;
      detectAndValidateApiKey(cleanKey);
      showSavedTag();
    }
    if (stored.targetLanguage && targetLanguageSelect) {
      targetLanguageSelect.value = stored.targetLanguage;
    }

    // Model selection: strictly models/gemini-3.5-live-translate-preview
    chrome.storage.local.set({ model: DEFAULT_MODEL });

    if (Array.isArray(stored.disabledDomains)) {
      disabledDomains = stored.disabledDomains;
    } else {
      disabledDomains = [];
    }
    updateSiteVisibilityUI();

    if (showFloatingWidgetToggle) {
      // Default to false (disabled) if undefined
      showFloatingWidgetToggle.checked = typeof stored.showFloatingWidget === 'boolean' ? stored.showFloatingWidget : false;
    }
    if (typeof stored.tabOriginalVolume === 'number' && originalVolSlider && originalVolLabel) {
      originalVolSlider.value = Math.round(stored.tabOriginalVolume * 100);
      originalVolLabel.textContent = `${originalVolSlider.value}%`;
    }
    if (typeof stored.translatedVolume === 'number' && translatedVolSlider && translatedVolLabel) {
      translatedVolSlider.value = Math.round(stored.translatedVolume * 100);
      translatedVolLabel.textContent = `${translatedVolSlider.value}%`;
    }
  } catch (e) {
    console.warn('oaDub: Stored settings load error:', e);
  }

  // 3. Sync initial state from background service worker
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_STATUS' });
    if (response && response.success && response.state) {
      applyState(response.state);
    }
  } catch (e) {
    console.warn('oaDub: Background state fetch failed:', e);
  }
  updateRecordedDurationBadge();

  // 4. Tab Navigation Management
  function switchTab(targetTab) {
    if (targetTab === 'settings') {
      if (tabDubbingBtn) tabDubbingBtn.classList.remove('active');
      if (tabSettingsBtn) tabSettingsBtn.classList.add('active');
      if (paneDubbing) paneDubbing.classList.add('hidden');
      if (paneSettings) paneSettings.classList.remove('hidden');
    } else {
      if (tabSettingsBtn) tabSettingsBtn.classList.remove('active');
      if (tabDubbingBtn) tabDubbingBtn.classList.add('active');
      if (paneSettings) paneSettings.classList.add('hidden');
      if (paneDubbing) paneDubbing.classList.remove('hidden');
    }
  }

  if (tabDubbingBtn) {
    tabDubbingBtn.addEventListener('click', () => switchTab('dubbing'));
  }
  if (tabSettingsBtn) {
    tabSettingsBtn.addEventListener('click', () => switchTab('settings'));
  }

  // 5. API Key Guide Collapsible Toggle
  if (toggleGuideBtn && guideContent) {
    toggleGuideBtn.addEventListener('click', () => {
      toggleGuideBtn.classList.toggle('open');
      guideContent.classList.toggle('hidden');
    });
  }

  // 6. UI Event Listeners
  // Toggle Floating Hub Widget
  if (showFloatingWidgetToggle) {
    showFloatingWidgetToggle.addEventListener('change', () => {
      chrome.storage.local.set({ showFloatingWidget: showFloatingWidgetToggle.checked });
    });
  }
  // Toggle API Key Visibility
  if (toggleApiKeyBtn && apiKeyInput) {
    toggleApiKeyBtn.addEventListener('click', () => {
      apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    });
  }

  // Auto-save & validate API Key
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', () => {
      const key = apiKeyInput.value.trim().replace(/^["']|["']$/g, '');
      chrome.storage.local.set({ apiKey: key });
      detectAndValidateApiKey(key);
      showSavedTag();
      hideError();
    });
  }

  // Auto-save Target Language
  if (targetLanguageSelect) {
    targetLanguageSelect.addEventListener('change', () => {
      chrome.storage.local.set({ targetLanguage: targetLanguageSelect.value });
    });
  }

  // Volume Sliders
  if (originalVolSlider && originalVolLabel) {
    originalVolSlider.addEventListener('input', () => {
      const val = parseInt(originalVolSlider.value, 10);
      originalVolLabel.textContent = `${val}%`;
      const floatVal = val / 100;
      chrome.storage.local.set({ tabOriginalVolume: floatVal });
      notifyVolumeUpdate();
    });
  }

  if (translatedVolSlider && translatedVolLabel) {
    translatedVolSlider.addEventListener('input', () => {
      const val = parseInt(translatedVolSlider.value, 10);
      translatedVolLabel.textContent = `${val}%`;
      const floatVal = val / 100;
      chrome.storage.local.set({ translatedVolume: floatVal });
      notifyVolumeUpdate();
    });
  }

  function notifyVolumeUpdate() {
    const origVol = originalVolSlider ? parseInt(originalVolSlider.value, 10) / 100 : 0.2;
    const transVol = translatedVolSlider ? parseInt(translatedVolSlider.value, 10) / 100 : 1.0;
    chrome.runtime.sendMessage({
      action: 'UPDATE_VOLUMES',
      tabOriginalVolume: origVol,
      translatedVolume: transVol
    }).catch(() => {});
  }

  // Unmute Active Media Button
  if (unmuteMediaBtn) {
    unmuteMediaBtn.addEventListener('click', async () => {
      try {
        const btnSpan = unmuteMediaBtn.querySelector('span');
        if (btnSpan) btnSpan.textContent = 'Ses Açılıyor...';
        
        await chrome.runtime.sendMessage({ action: 'UNMUTE_PAGE_MEDIA' });
        
        if (btnSpan) btnSpan.textContent = 'Ses Açıldı! 🔊';
        setTimeout(() => {
          if (mutedWarningBanner) mutedWarningBanner.classList.add('hidden');
          if (btnSpan) btnSpan.textContent = 'Videonun Sesini Aç (Unmute)';
        }, 1200);
      } catch (err) {
        console.warn('oaDub: Unmute message error:', err);
      }
    });
  }

  // Site Visibility Toggle Button
  if (toggleSiteVisibilityBtn) {
    toggleSiteVisibilityBtn.addEventListener('click', async () => {
      if (!currentHostname || toggleSiteVisibilityBtn.disabled) return;

      const rootDomain = currentHostname.replace(/^www\./, '');
      const isCurrentlyDisabled = disabledDomains.some(d => {
        const cd = d.toLowerCase();
        const ch = currentHostname.toLowerCase();
        return ch === cd || ch.endsWith('.' + cd) || cd.endsWith('.' + ch);
      });

      if (!isCurrentlyDisabled) {
        if (!disabledDomains.includes(currentHostname)) disabledDomains.push(currentHostname);
        if (rootDomain && !disabledDomains.includes(rootDomain)) disabledDomains.push(rootDomain);
      } else {
        disabledDomains = disabledDomains.filter(d => {
          const cd = d.toLowerCase();
          const ch = currentHostname.toLowerCase();
          const cr = rootDomain.toLowerCase();
          return cd !== ch && cd !== cr && !ch.endsWith('.' + cd);
        });
      }

      await chrome.storage.local.set({ disabledDomains: [...disabledDomains] });
      updateSiteVisibilityUI();
    });
  }

  // Toggle Translate Action (Start / Stop)
  if (toggleTranslateBtn) {
    toggleTranslateBtn.addEventListener('click', async () => {
      hideError();

      if (!isTranslating) {
        // START TRANSLATION
        const apiKey = apiKeyInput ? apiKeyInput.value.trim().replace(/^["']|["']$/g, '') : '';
        if (!apiKey) {
          showError('Lütfen geçerli bir Gemini API anahtarı giriniz.');
          if (apiKeyInput) apiKeyInput.focus();
          return;
        }

        if (!currentTab || !currentTab.id) {
          showError('Çeviri yapılacak aktif bir sekme bulunamadı.');
          return;
        }

        updateStatusUI('connecting');
        if (btnText) btnText.textContent = 'Bağlanıyor...';
        toggleTranslateBtn.disabled = true;

        const origVol = originalVolSlider ? parseInt(originalVolSlider.value, 10) / 100 : 0.2;
        const transVol = translatedVolSlider ? parseInt(translatedVolSlider.value, 10) / 100 : 1.0;
        const targetLang = targetLanguageSelect ? targetLanguageSelect.value : 'tr';

        try {
          const response = await chrome.runtime.sendMessage({
            action: 'START_TRANSLATION',
            tabId: currentTab.id,
            apiKey: apiKey,
            targetLanguage: targetLang,
            model: DEFAULT_MODEL,
            tabOriginalVolume: origVol,
            translatedVolume: transVol
          });

          toggleTranslateBtn.disabled = false;

          if (response && response.success) {
            isTranslating = true;
            applyState(response.state);
          } else {
            showError(response ? response.error : 'Çeviri başlatılamadı. Lütfen API anahtarınızı ve internet bağlantınızı kontrol ediniz.');
            updateStatusUI('error');
            resetButtonUI();
          }
        } catch (err) {
          toggleTranslateBtn.disabled = false;
          showError(err.message || 'Bağlantı hatası oluştu.');
          updateStatusUI('error');
          resetButtonUI();
        }
      } else {
        // STOP TRANSLATION
        if (btnText) btnText.textContent = 'Durduruluyor...';
        toggleTranslateBtn.disabled = true;

        try {
          await chrome.runtime.sendMessage({ action: 'STOP_TRANSLATION' });
          isTranslating = false;
          toggleTranslateBtn.disabled = false;
          updateStatusUI('idle');
          resetButtonUI();
        } catch (err) {
          toggleTranslateBtn.disabled = false;
          console.error('oaDub: Durdurma hatası:', err);
          updateStatusUI('idle');
          resetButtonUI();
        }
      }
    });
  }

  // Download Recorded Audio (.wav)
  if (downloadAudioBtn) {
    downloadAudioBtn.addEventListener('click', async () => {
      try {
        const span = downloadAudioBtn.querySelector('span');
        const origText = span ? span.textContent : 'Ses (.wav)';
        if (span) span.textContent = 'Hazırlanıyor...';

        const resp = await chrome.runtime.sendMessage({ action: 'GET_RECORDED_AUDIO' });
        if (resp && resp.success && resp.dataUrl && resp.durationSeconds > 0) {
          const a = document.createElement('a');
          a.href = resp.dataUrl;
          a.download = getFormattedFilename('Dublaj', 'wav');
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          if (span) {
            span.textContent = 'İndirildi!';
            setTimeout(() => {
              span.textContent = origText;
            }, 1500);
          }
        } else {
          if (span) span.textContent = origText;
          showError('Henüz kaydedilmiş dublaj sesi bulunmuyor veya süre 0 sn.');
        }
      } catch (err) {
        console.error('oaDub: Ses indirme hatası:', err);
        showError('Ses dosyası indirilirken bir hata oluştu.');
      }
    });
  }

  // Download Subtitles (.srt)
  if (downloadSrtBtn) {
    downloadSrtBtn.addEventListener('click', () => {
      try {
        const span = downloadSrtBtn.querySelector('span');
        const origText = span ? span.textContent : '.srt';

        const items = transcriptStream ? transcriptStream.querySelectorAll('.transcript-item') : [];
        if (items.length === 0) {
          showError('İndirilecek altyazı verisi bulunamadı.');
          return;
        }

        let srtContent = '';
        items.forEach((item, index) => {
          const textEl = item.querySelector('.transcript-text');
          const text = textEl ? textEl.textContent.trim() : '';
          if (!text) return;

          const attrSec = parseFloat(item.getAttribute('data-elapsed-sec'));
          const startSec = !isNaN(attrSec) ? attrSec : index * 3.5;
          const endSec = startSec + Math.max(2.5, text.length * 0.08);

          srtContent += `${index + 1}\n`;
          srtContent += `${formatTimeSrt(startSec)} --> ${formatTimeSrt(endSec)}\n`;
          srtContent += `${text}\n\n`;
        });

        if (!srtContent.trim()) {
          showError('İndirilecek altyazı verisi bulunamadı.');
          return;
        }

        const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = getFormattedFilename('Altyazi', 'srt');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (span) {
          span.textContent = 'İndirildi!';
          setTimeout(() => {
            span.textContent = origText;
          }, 1500);
        }
      } catch (err) {
        console.error('oaDub: SRT indirme hatası:', err);
        showError('SRT altyazı dosyası oluşturulurken hata oluştu.');
      }
    });
  }

  // Download Web Subtitles (.vtt)
  if (downloadVttBtn) {
    downloadVttBtn.addEventListener('click', () => {
      try {
        const span = downloadVttBtn.querySelector('span');
        const origText = span ? span.textContent : '.vtt';

        const items = transcriptStream ? transcriptStream.querySelectorAll('.transcript-item') : [];
        if (items.length === 0) {
          showError('İndirilecek altyazı verisi bulunamadı.');
          return;
        }

        let vttContent = 'WEBVTT - oaDub Simültane Çeviri\n\n';
        items.forEach((item, index) => {
          const textEl = item.querySelector('.transcript-text');
          const text = textEl ? textEl.textContent.trim() : '';
          if (!text) return;

          const attrSec = parseFloat(item.getAttribute('data-elapsed-sec'));
          const startSec = !isNaN(attrSec) ? attrSec : index * 3.5;
          const endSec = startSec + Math.max(2.5, text.length * 0.08);

          vttContent += `${index + 1}\n`;
          vttContent += `${formatTimeVtt(startSec)} --> ${formatTimeVtt(endSec)}\n`;
          vttContent += `${text}\n\n`;
        });

        if (vttContent.trim() === 'WEBVTT - oaDub Simültane Çeviri') {
          showError('İndirilecek altyazı verisi bulunamadı.');
          return;
        }

        const blob = new Blob([vttContent], { type: 'text/vtt;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = getFormattedFilename('Altyazi', 'vtt');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (span) {
          span.textContent = 'İndirildi!';
          setTimeout(() => {
            span.textContent = origText;
          }, 1500);
        }
      } catch (err) {
        console.error('oaDub: VTT indirme hatası:', err);
        showError('VTT altyazı dosyası oluşturulurken hata oluştu.');
      }
    });
  }

  // Download Transcript Text (.txt)
  if (downloadTranscriptBtn) {
    downloadTranscriptBtn.addEventListener('click', () => {
      try {
        const span = downloadTranscriptBtn.querySelector('span');
        const origText = span ? span.textContent : '.txt';

        const items = transcriptStream ? transcriptStream.querySelectorAll('.transcript-item') : [];
        const lines = [];
        items.forEach((item) => {
          const timeEl = item.querySelector('.timestamp');
          const textEl = item.querySelector('.transcript-text');
          const time = timeEl ? timeEl.textContent.trim() : '';
          const text = textEl ? textEl.textContent.trim() : '';
          if (text) {
            lines.push(`${time} ${text}`.trim());
          }
        });

        if (lines.length === 0) {
          showError('İndirilecek transkript metni bulunamadı.');
          return;
        }

        const transcriptContent = lines.join('\n');
        const blob = new Blob([transcriptContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = getFormattedFilename('Transkript', 'txt');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (span) {
          span.textContent = 'İndirildi!';
          setTimeout(() => {
            span.textContent = origText;
          }, 1500);
        }
      } catch (err) {
        console.error('oaDub: Transkript indirme hatası:', err);
        showError('Transkript indirilirken bir hata oluştu.');
      }
    });
  }

  // Copy Transcripts
  if (copyTranscriptBtn && transcriptStream) {
    copyTranscriptBtn.addEventListener('click', () => {
      const textItems = Array.from(transcriptStream.querySelectorAll('.transcript-text'))
        .map(el => el.textContent.trim())
        .filter(Boolean)
        .join('\n');
      
      if (textItems) {
        navigator.clipboard.writeText(textItems).then(() => {
          const span = copyTranscriptBtn.querySelector('span');
          if (span) {
            const origText = span.textContent;
            span.textContent = 'Kopyalandı!';
            setTimeout(() => {
              span.textContent = origText;
            }, 1500);
          }
        });
      }
    });
  }

  // Clear Transcripts
  if (clearTranscriptBtn) {
    clearTranscriptBtn.addEventListener('click', () => {
      if (transcriptStream) {
        transcriptStream.innerHTML = '';
        transcriptStream.classList.add('hidden');
      }
      if (transcriptPlaceholder) {
        transcriptPlaceholder.classList.remove('hidden');
      }
      chrome.runtime.sendMessage({ action: 'CLEAR_TRANSCRIPTS' }).catch(() => {});
    });
  }

  // 5. Runtime Message Listener for Real-time Updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'CONNECTION_STATUS') {
      updateStatusUI(message.status);
      if (message.status === 'error' && message.error) {
        showError(message.error);
        isTranslating = false;
        stopDurationTracker();
        updateRecordedDurationBadge();
        resetButtonUI();
      } else if (message.status === 'translating' || message.status === 'connected') {
        isTranslating = true;
        startDurationTracker();
        setButtonTranslatingUI();
      } else if (message.status === 'idle') {
        isTranslating = false;
        stopDurationTracker();
        updateRecordedDurationBadge();
        resetButtonUI();
      }
    } else if (message.action === 'TRANSCRIPT_UPDATE') {
      appendTranscript(message.text, message.elapsedSec);
    } else if (message.action === 'AUDIO_ERROR') {
      showError(message.error);
      updateStatusUI('error');
      isTranslating = false;
      stopDurationTracker();
      updateRecordedDurationBadge();
      resetButtonUI();
    } else if (message.action === 'MEDIA_MUTED_STATUS') {
      if (mutedWarningBanner) {
        if (message.isMuted) {
          mutedWarningBanner.classList.remove('hidden');
        } else {
          mutedWarningBanner.classList.add('hidden');
        }
      }
    }
  });

  // UI State Helpers
  function applyState(state) {
    if (!state) return;
    isTranslating = !!state.isTranslating;

    if (state.connectionStatus) {
      updateStatusUI(state.connectionStatus);
    }

    if (state.isTranslating) {
      startDurationTracker();
      setButtonTranslatingUI();
    } else {
      stopDurationTracker();
      updateRecordedDurationBadge();
      resetButtonUI();
    }

    // Capture Mode Tag
    if (captureModeTag) {
      if (state.captureMode === 'dom') {
        captureModeTag.textContent = 'DOM Medya';
        captureModeTag.className = 'capture-mode-tag dom-mode';
        captureModeTag.title = 'Hibrit DOM Video/Audio Yakalama Modu (Instagram/SPA & Mobil)';
      } else {
        captureModeTag.textContent = 'Sekme Sesi';
        captureModeTag.className = 'capture-mode-tag tab-mode';
        captureModeTag.title = 'Masaüstü Sekme Sesi Yakalama (tabCapture)';
      }
    }

    // Muted Media Warning
    if (mutedWarningBanner) {
      if (state.isMediaMuted) {
        mutedWarningBanner.classList.remove('hidden');
      } else {
        mutedWarningBanner.classList.add('hidden');
      }
    }

    if (state.lastError) {
      showError(state.lastError);
    } else {
      hideError();
    }

    if (state.transcripts && state.transcripts.length > 0) {
      if (transcriptPlaceholder) transcriptPlaceholder.classList.add('hidden');
      if (transcriptStream) {
        transcriptStream.classList.remove('hidden');
        transcriptStream.innerHTML = '';
        state.transcripts.forEach(item => {
          const itemEl = createTranscriptElement(item.text, item.timestamp, item.elapsedSec);
          transcriptStream.appendChild(itemEl);
        });
      }
      if (transcriptContainer) {
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
      }
    }
  }

  function updateStatusUI(status) {
    if (!statusBadge || !statusText) return;
    statusBadge.className = `status-indicator-badge ${status}`;
    
    switch (status) {
      case 'idle':
        statusText.textContent = 'Hazır';
        if (pulseRecording) pulseRecording.classList.add('hidden');
        break;
      case 'connecting':
        statusText.textContent = 'Bağlanıyor...';
        if (pulseRecording) pulseRecording.classList.add('hidden');
        break;
      case 'connected':
        statusText.textContent = 'Bağlandı';
        if (pulseRecording) pulseRecording.classList.remove('hidden');
        break;
      case 'translating':
        statusText.textContent = 'Çeviriyor & Seslendiriyor';
        if (pulseRecording) pulseRecording.classList.remove('hidden');
        break;
      case 'error':
        statusText.textContent = 'Hata';
        if (pulseRecording) pulseRecording.classList.add('hidden');
        break;
      default:
        statusText.textContent = 'Hazır';
        if (pulseRecording) pulseRecording.classList.add('hidden');
        break;
    }
  }

  function setButtonTranslatingUI() {
    if (!toggleTranslateBtn) return;
    toggleTranslateBtn.classList.add('stop-mode');
    if (playIcon) playIcon.classList.add('hidden');
    if (stopIcon) stopIcon.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Simültane Çeviriyi Durdur';
  }

  function resetButtonUI() {
    if (!toggleTranslateBtn) return;
    toggleTranslateBtn.classList.remove('stop-mode');
    if (playIcon) playIcon.classList.remove('hidden');
    if (stopIcon) stopIcon.classList.add('hidden');
    if (btnText) btnText.textContent = 'Simültane Çeviriyi Başlat';
  }

  function appendTranscript(text, elapsedSec) {
    if (!text || !transcriptStream) return;
    if (transcriptPlaceholder) transcriptPlaceholder.classList.add('hidden');
    transcriptStream.classList.remove('hidden');

    const itemEl = createTranscriptElement(text, new Date().toLocaleTimeString(), elapsedSec);
    transcriptStream.appendChild(itemEl);
    if (transcriptContainer) {
      transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
    }
  }

  function createTranscriptElement(text, timestamp, elapsedSec) {
    const div = document.createElement('div');
    div.className = 'transcript-item';
    if (typeof elapsedSec === 'number') {
      div.setAttribute('data-elapsed-sec', elapsedSec);
    }
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'timestamp';
    timeSpan.textContent = `[${timestamp}]`;

    const textSpan = document.createElement('span');
    textSpan.className = 'transcript-text';
    textSpan.textContent = ` ${text}`;

    div.appendChild(timeSpan);
    div.appendChild(textSpan);
    return div;
  }

  function formatTimeSrt(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  function formatTimeVtt(seconds) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  function formatDuration(totalSeconds) {
    if (isNaN(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
    const rounded = Math.floor(totalSeconds);
    const mins = Math.floor(rounded / 60);
    const secs = rounded % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function getFormattedFilename(prefix, ext) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `oaDub_${prefix}_${year}-${month}-${day}_${hours}-${minutes}.${ext}`;
  }

  function startDurationTracker() {
    stopDurationTracker();
    updateRecordedDurationBadge();
    durationTimerInterval = setInterval(() => {
      updateRecordedDurationBadge();
    }, 1000);
  }

  function stopDurationTracker() {
    if (durationTimerInterval) {
      clearInterval(durationTimerInterval);
      durationTimerInterval = null;
    }
  }

  async function updateRecordedDurationBadge() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'GET_RECORDED_AUDIO' });
      if (resp && resp.success && typeof resp.durationSeconds === 'number') {
        currentRecordedDuration = resp.durationSeconds;
        if (recordedDurationBadge) {
          recordedDurationBadge.textContent = formatDuration(currentRecordedDuration);
          if (currentRecordedDuration > 0 || isTranslating) {
            recordedDurationBadge.classList.remove('hidden');
          } else {
            recordedDurationBadge.classList.add('hidden');
          }
        }
      }
    } catch (e) {
      // Ignore background communication errors
    }
  }

  function detectAndValidateApiKey(key) {
    if (!apiKeyTypeBadge) return;
    const cleanKey = (key || '').trim().replace(/^["']|["']$/g, '');
    if (!cleanKey) {
      apiKeyTypeBadge.className = 'key-type-badge hidden';
      apiKeyTypeBadge.textContent = '';
      return;
    }

    if (cleanKey.startsWith('AQ')) {
      apiKeyTypeBadge.className = 'key-type-badge key-type-auth';
      apiKeyTypeBadge.textContent = '🛡️ Auth Key (Önerilen)';
    } else if (cleanKey.startsWith('AI')) {
      apiKeyTypeBadge.className = 'key-type-badge key-type-standard';
      apiKeyTypeBadge.textContent = '🔑 Standard Key';
    } else {
      apiKeyTypeBadge.className = 'key-type-badge key-type-unknown';
      apiKeyTypeBadge.textContent = '⚠️ Tanınmayan Format';
    }
  }

  function updateSiteVisibilityUI() {
    if (!currentDomainBadge || !toggleSiteVisibilityBtn) return;

    if (!currentHostname || currentHostname === 'chrome' || currentHostname === 'edge' || currentHostname === 'about' || currentHostname === 'chrome-extension' || currentHostname === 'extension') {
      currentDomainBadge.textContent = currentHostname ? `${currentHostname}://` : 'Sistem Sayfası';
      currentDomainBadge.className = 'domain-badge system-domain';
      if (siteControlDesc) siteControlDesc.textContent = 'Tarayıcı sistem sayfalarında buton devre dışıdır';
      if (toggleSiteVisibilityText) toggleSiteVisibilityText.textContent = 'Desteklenmiyor';
      toggleSiteVisibilityBtn.className = 'btn-site-toggle';
      toggleSiteVisibilityBtn.disabled = true;
      return;
    }

    currentDomainBadge.textContent = currentHostname;
    const isDomainDisabled = disabledDomains.some(d => {
      const cd = (d || '').toLowerCase();
      const ch = currentHostname.toLowerCase();
      return ch === cd || ch.endsWith('.' + cd) || cd.endsWith('.' + ch);
    });

    if (isDomainDisabled) {
      currentDomainBadge.className = 'domain-badge disabled-domain';
      if (siteControlDesc) siteControlDesc.textContent = 'Yüzen buton bu sitede gizlendi';
      if (toggleSiteVisibilityText) toggleSiteVisibilityText.textContent = 'Bu Sitede Göster';
      toggleSiteVisibilityBtn.className = 'btn-site-toggle hidden-state';
      toggleSiteVisibilityBtn.disabled = false;
    } else {
      currentDomainBadge.className = 'domain-badge';
      if (siteControlDesc) siteControlDesc.textContent = 'Yüzen buton bu sitede aktif';
      if (toggleSiteVisibilityText) toggleSiteVisibilityText.textContent = 'Bu Sitede Gizle';
      toggleSiteVisibilityBtn.className = 'btn-site-toggle';
      toggleSiteVisibilityBtn.disabled = false;
    }
  }

  // Listen for storage changes dynamically (e.g. if modified from page hub)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.disabledDomains && Array.isArray(changes.disabledDomains.newValue)) {
        disabledDomains = changes.disabledDomains.newValue;
        updateSiteVisibilityUI();
      }
      if (changes.showFloatingWidget && showFloatingWidgetToggle) {
        showFloatingWidgetToggle.checked = changes.showFloatingWidget.newValue === true;
      }
    }
  });

  function showError(msg) {
    if (!errorBanner || !errorMessage) return;
    const cleanMsg = typeof msg === 'string' && msg.trim() ? msg.trim() : 'Bilinmeyen bir hata oluştu. Lütfen bağlantınızı ve ayarlarınızı kontrol ediniz.';
    errorMessage.textContent = cleanMsg;
    errorBanner.classList.remove('hidden');
  }

  function hideError() {
    if (errorBanner) {
      errorBanner.classList.add('hidden');
    }
  }

  function showSavedTag() {
    if (keySavedTag) {
      keySavedTag.classList.add('visible');
      setTimeout(() => {
        keySavedTag.classList.remove('visible');
      }, 2000);
    }
  }
});
