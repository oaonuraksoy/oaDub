/**
 * oaDub - Offscreen Audio Capture & Gemini Live Translator
 * Captures tab audio or receives injected DOM PCM chunks, resamples to 16kHz mono PCM,
 * streams to Gemini Bidi WebSocket, and plays back translated 24kHz audio in real-time.
 */

let mediaStream = null;
let captureAudioContext = null;
let playbackAudioContext = null;
let sourceNode = null;
let tabGainNode = null;
let processorNode = null;
let translatedGainNode = null;
let webSocket = null;

let isRecording = false;
let currentCaptureMode = 'tab'; // 'tab' | 'dom'
let nextPlayTime = 0;
let pcmBufferAccumulator = [];
let recordedChunks = []; // Accumulated 24kHz 16-bit Mono PCM chunks for live audio recording
const TARGET_SAMPLE_RATE = 16000;
const ACCUMULATOR_TARGET_SAMPLES = 3200; // ~200ms chunks at 16kHz

// Message listener for control commands
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'START_RECORDING':
      startRecording(message)
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error('oaDub offscreen: startRecording error', err);
          notifyStatus('error', err.message);
          sendResponse({ success: false, error: err.message });
        });
      return true;

    case 'STOP_RECORDING':
      stopRecording()
        .then(() => sendResponse({ success: true }))
        .catch((err) => {
          console.error('oaDub offscreen: stopRecording error', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;

    case 'UPDATE_VOLUMES':
      updateVolumes(message.tabOriginalVolume, message.translatedVolume);
      sendResponse({ success: true });
      break;

    case 'INJECT_PCM_CHUNK':
      if (isRecording && message.pcmChunk) {
        sendAudioChunkBase64(message.pcmChunk);
      }
      sendResponse({ success: true });
      break;

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
      break;
    }

    case 'CLEAR_RECORDED_AUDIO':
      recordedChunks = [];
      sendResponse({ success: true });
      break;

    default:
      break;
  }
});

/**
 * Notifies the service worker of connection/translation status.
 */
function notifyStatus(status, error = null) {
  chrome.runtime.sendMessage({
    action: 'CONNECTION_STATUS',
    status: status,
    error: error
  }).catch(() => {});
}

/**
 * Initializes audio capture (tab stream or DOM injection) and WebSocket streaming.
 */
async function startRecording(config) {
  if (isRecording) {
    await stopRecording();
  }

  recordedChunks = [];
  notifyStatus('connecting');
  currentCaptureMode = config.captureMode || (config.streamId ? 'tab' : 'dom');

  // 1. Initialize Playback Web Audio Context (24kHz for Gemini Live Audio output)
  playbackAudioContext = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: 24000
  });

  if (playbackAudioContext.state === 'suspended') {
    await playbackAudioContext.resume();
  }

  nextPlayTime = playbackAudioContext.currentTime;

  // Setup translated output gain
  translatedGainNode = playbackAudioContext.createGain();
  translatedGainNode.gain.value = typeof config.translatedVolume === 'number' ? config.translatedVolume : 1.0;
  translatedGainNode.connect(playbackAudioContext.destination);

  // 2. Setup Tab Audio Capture if in 'tab' capture mode
  if (currentCaptureMode === 'tab' && config.streamId) {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: config.streamId
          }
        },
        video: false
      });
    } catch (err) {
      console.warn('oaDub offscreen: Tab media stream acquisition failed, switching to DOM injection mode:', err);
      currentCaptureMode = 'dom';
    }

    if (mediaStream && mediaStream.getAudioTracks().length > 0) {
      // Resilient track ended handling
      mediaStream.getAudioTracks()[0].onended = () => {
        console.warn('oaDub offscreen: Tab audio track ended. Continuing session.');
      };

      captureAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (captureAudioContext.state === 'suspended') {
        await captureAudioContext.resume();
      }

      sourceNode = captureAudioContext.createMediaStreamSource(mediaStream);

      // Tab passthrough gain (allows user to hear original tab sound at desired level)
      tabGainNode = captureAudioContext.createGain();
      tabGainNode.gain.value = typeof config.tabOriginalVolume === 'number' ? config.tabOriginalVolume : 0.2;

      sourceNode.connect(tabGainNode);
      tabGainNode.connect(captureAudioContext.destination);

      // Audio Processor (Resampling to 16kHz 16-bit Mono PCM)
      const inputSampleRate = captureAudioContext.sampleRate;
      const bufferSize = 4096;
      processorNode = captureAudioContext.createScriptProcessor(bufferSize, 1, 1);
      pcmBufferAccumulator = [];

      processorNode.onaudioprocess = (e) => {
        if (!isRecording || !webSocket || webSocket.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        const resampledData = resampleTo16k(inputData, inputSampleRate);
        
        for (let i = 0; i < resampledData.length; i++) {
          pcmBufferAccumulator.push(resampledData[i]);
        }

        if (pcmBufferAccumulator.length >= ACCUMULATOR_TARGET_SAMPLES) {
          const chunk = new Int16Array(pcmBufferAccumulator.splice(0, ACCUMULATOR_TARGET_SAMPLES));
          sendAudioChunk(chunk);
        }
      };

      sourceNode.connect(processorNode);
      processorNode.connect(captureAudioContext.destination);
    }
  }

  // 3. Initialize WebSocket Connection to Gemini Live API
  await initWebSocket(config);

  isRecording = true;
}

/**
 * Initializes the Gemini Live Bi-directional WebSocket connection.
 */
function initWebSocket(config) {
  return new Promise((resolve, reject) => {
    const rawApiKey = (config.apiKey || '').trim().replace(/^["']|["']$/g, '');
    const cleanApiKey = encodeURIComponent(rawApiKey);
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${cleanApiKey}`;
    
    try {
      webSocket = new WebSocket(wsUrl);
    } catch (err) {
      return reject(new Error(`WebSocket başlatılamadı: ${err.message}`));
    }

    let setupSent = false;

    webSocket.onopen = () => {
      // Send initial Setup Frame
      const langMap = {
        'tr': 'Turkish',
        'en': 'English',
        'de': 'German',
        'es': 'Spanish',
        'fr': 'French',
        'it': 'Italian',
        'ja': 'Japanese',
        'ko': 'Korean',
        'ru': 'Russian',
        'ar': 'Arabic',
        'pt': 'Portuguese',
        'nl': 'Dutch',
        'pl': 'Polish',
        'zh': 'Chinese',
        'hi': 'Hindi'
      };
      const targetLangCode = config.targetLanguage || 'tr';
      const targetLangName = langMap[targetLangCode] || targetLangCode;

      const setupMessage = {
        setup: {
          model: 'models/gemini-3.5-live-translate-preview',
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Puck'
                }
              }
            }
          },
          systemInstruction: {
            parts: [
              {
                text: `You are a professional simultaneous interpreter and voice dubber. Translate spoken speech from the incoming audio stream into natural, fluent, grammatically cohesive ${targetLangName} (${targetLangCode}) sentences and phrases. Speak smoothly with natural human pacing and intonation. Do not translate word-by-word or speak broken word fragments. Deliver clear, coherent, meaningful dubbed phrases. Speak ONLY the translated speech.`
              }
            ]
          }
        }
      };

      webSocket.send(JSON.stringify(setupMessage));
      setupSent = true;
      notifyStatus('connected');
      resolve();
    };

    webSocket.onmessage = async (event) => {
      try {
        let rawData = event.data;
        if (rawData instanceof Blob) {
          rawData = await rawData.text();
        }

        const response = JSON.parse(rawData);
        handleServerMessage(response);
      } catch (err) {
        console.error('oaDub: Error parsing server message:', err);
      }
    };

    webSocket.onerror = (err) => {
      console.error('oaDub: WebSocket Error:', err);
      const errMsg = 'Gemini Live WebSocket bağlantı hatası oluştu. Lütfen bağlantınızı ve API anahtarınızı kontrol edin.';
      notifyStatus('error', errMsg);
      if (!setupSent) {
        reject(new Error(errMsg));
      }
    };

    webSocket.onclose = (event) => {
      console.warn('oaDub: WebSocket Closed:', event.code, event.reason);
      if (isRecording || !setupSent) {
        let finalError = `Bağlantı kapandı (${event.code}): ${event.reason || 'Sunucu bağlantıyı sonlandırdı'}`;
        if (event.code === 1008 || event.code === 4001 || event.code === 4003 || event.code === 4401 || event.code === 4403) {
          finalError = `Yetkilendirme / İzin Hatası (${event.code}): ${event.reason || 'API anahtarınızı veya model erişim izinlerinizi kontrol edin.'}`;
        } else if (event.code === 1007) {
          finalError = `Protokol/Veri Hatası (1007): ${event.reason || 'Geçersiz setup payload veya desteklenmeyen parametre'}`;
        } else if (event.code === 1006) {
          finalError = `Bağlantı kesildi (1006): ${event.reason || 'Gemini Live sunucusuna ulaşılamadı veya bağlantı aniden kapandı'}`;
        }

        notifyStatus('error', finalError);
        if (!setupSent) {
          reject(new Error(finalError));
        }
        stopRecording();
      }
    };
  });
}

/**
 * Handles incoming responses from Gemini Live API.
 */
function handleServerMessage(response) {
  if (response.error) {
    const errorMsg = `Gemini API Hatası (${response.error.code || response.error.status || 'Bilinmeyen'}): ${response.error.message || JSON.stringify(response.error)}`;
    console.error('oaDub: Gemini Server Error:', response.error);
    notifyStatus('error', errorMsg);
    stopRecording();
    return;
  }

  if (response.serverContent) {
    const serverContent = response.serverContent;

    // Handle Interrupted event (reset playback buffer)
    if (serverContent.interrupted) {
      if (playbackAudioContext) {
        nextPlayTime = playbackAudioContext.currentTime;
      }
    }

    // Output transcription support (text stream)
    if (serverContent.outputTranscription) {
      const outText = typeof serverContent.outputTranscription === 'string'
        ? serverContent.outputTranscription
        : (serverContent.outputTranscription.text || '');
      if (outText) {
        chrome.runtime.sendMessage({
          action: 'TRANSCRIPT_UPDATE',
          text: outText
        }).catch(() => {});
      }
    }

    // Input transcription support (recognized user audio)
    if (serverContent.inputTranscription) {
      const inText = typeof serverContent.inputTranscription === 'string'
        ? serverContent.inputTranscription
        : (serverContent.inputTranscription.text || '');
      if (inText) {
        chrome.runtime.sendMessage({
          action: 'TRANSCRIPT_UPDATE',
          text: `[Orijinal]: ${inText}`
        }).catch(() => {});
      }
    }

    // Handle Model Turn with Audio and Transcript
    if (serverContent.modelTurn && Array.isArray(serverContent.modelTurn.parts)) {
      for (const part of serverContent.modelTurn.parts) {
        // 1. Text Transcript
        if (part.text) {
          chrome.runtime.sendMessage({
            action: 'TRANSCRIPT_UPDATE',
            text: part.text
          }).catch(() => {});
        }

        // 2. Audio PCM Payload (24kHz Mono 16-bit)
        if (part.inlineData && part.inlineData.data) {
          notifyStatus('translating');
          playAudioChunk(part.inlineData.data);
        }
      }
    }

    if (serverContent.turnComplete) {
      if (playbackAudioContext) {
        nextPlayTime = playbackAudioContext.currentTime;
      }
      notifyStatus('connected');
    }
  }
}

/**
 * Sends a 16kHz 16-bit mono PCM chunk (Int16Array) to Gemini WebSocket.
 */
function sendAudioChunk(int16Array) {
  if (!webSocket || webSocket.readyState !== WebSocket.OPEN) return;

  const base64Data = arrayBufferToBase64(int16Array.buffer);
  sendAudioChunkBase64(base64Data);
}

/**
 * Sends a Base64-encoded 16kHz 16-bit mono PCM chunk to Gemini WebSocket.
 */
function sendAudioChunkBase64(base64Data) {
  if (!webSocket || webSocket.readyState !== WebSocket.OPEN) return;

  const mediaMessage = {
    realtimeInput: {
      mediaChunks: [
        {
          mimeType: 'audio/pcm;rate=16000',
          data: base64Data
        }
      ]
    }
  };

  webSocket.send(JSON.stringify(mediaMessage));
}

/**
 * Plays a 24kHz 16-bit Mono PCM chunk seamlessly with buffer scheduling.
 */
function playAudioChunk(base64Data) {
  if (!playbackAudioContext) return;

  const arrayBuffer = base64ToArrayBuffer(base64Data);
  const int16Array = new Int16Array(arrayBuffer);
  recordedChunks.push(int16Array);
  const float32Array = new Float32Array(int16Array.length);

  // Convert 16-bit integer PCM to Float32 [-1.0, 1.0]
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }

  // Create 24kHz AudioBuffer
  const audioBuffer = playbackAudioContext.createBuffer(1, float32Array.length, 24000);
  audioBuffer.copyToChannel(float32Array, 0);

  // Create Source Node and Schedule Seamless Playback
  const source = playbackAudioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(translatedGainNode);

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
 * Updates gain levels for original tab and translated audio.
 */
function updateVolumes(tabVol, transVol) {
  if (tabGainNode && typeof tabVol === 'number') {
    tabGainNode.gain.setValueAtTime(tabVol, captureAudioContext ? captureAudioContext.currentTime : 0);
  }
  if (translatedGainNode && typeof transVol === 'number') {
    translatedGainNode.gain.setValueAtTime(transVol, playbackAudioContext ? playbackAudioContext.currentTime : 0);
  }
}

/**
 * Stops recording, audio processing and closes WebSocket.
 */
async function stopRecording() {
  isRecording = false;
  pcmBufferAccumulator = [];

  if (processorNode) {
    try {
      processorNode.disconnect();
    } catch (e) {}
    processorNode = null;
  }

  if (tabGainNode) {
    try {
      tabGainNode.disconnect();
    } catch (e) {}
    tabGainNode = null;
  }

  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch (e) {}
    sourceNode = null;
  }

  if (translatedGainNode) {
    try {
      translatedGainNode.disconnect();
    } catch (e) {}
    translatedGainNode = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  if (captureAudioContext) {
    try {
      await captureAudioContext.close();
    } catch (e) {}
    captureAudioContext = null;
  }

  if (playbackAudioContext) {
    try {
      await playbackAudioContext.close();
    } catch (e) {}
    playbackAudioContext = null;
  }

  if (webSocket) {
    try {
      if (webSocket.readyState === WebSocket.OPEN || webSocket.readyState === WebSocket.CONNECTING) {
        webSocket.close();
      }
    } catch (e) {}
    webSocket = null;
  }

  notifyStatus('idle');
}

/**
 * High-quality linear resampling from input sample rate to 16000 Hz Int16.
 */
function resampleTo16k(inputData, inputSampleRate) {
  if (inputSampleRate === TARGET_SAMPLE_RATE) {
    const output = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      let s = Math.max(-1, Math.min(1, inputData[i]));
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
 * Converts ArrayBuffer to Base64 string.
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
 * Converts Base64 string to ArrayBuffer.
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
 * Encodes an array of Int16Array PCM sample chunks into a standard RIFF WAVE ArrayBuffer.
 * Defaults to 24000 Hz, 16-bit Mono PCM.
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
  view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
  view.setUint16(22, channels, true); // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true); // SampleRate (24000)
  view.setUint32(28, byteRate, true); // ByteRate (48000)
  view.setUint16(32, blockAlign, true); // BlockAlign (2)
  view.setUint16(34, 16, true); // BitsPerSample (16)

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
