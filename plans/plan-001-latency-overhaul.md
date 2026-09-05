# plan-001: Latency Overhaul

## Adımlar
1. **manifest.json Değişiklikleri:**
   - offscreen, tabCapture/desktopCapture izinlerinin eklenmesi.
   - background service_worker tanımlarının yapılması.

2. **offscreen.js Yapılandırması:**
   - AudioContext kullanarak 16kHz PCM verisi toplama işleminin yapılandırılması.
   - ScriptProcessorNode veya AudioWorklet ile 100ms chunking işlemi.

3. **service_worker.js Yapılandırması:**
   - WebSocket bağlantısının yönetimi, BidiGenerateContent yapısının kurulması.
   - offscreen'den gelen PCM verilerinin WebSocket üzerinden Gemini API'ye aktarılması.

4. **content_script.js Entegrasyonu:**
   - Sayfa içi altyazı veya kullanıcı geri bildirimlerinin DOM üzerinden yönetilmesi (eğer gerekiyorsa).
   - Servis worker ile iletişim için mesajlaşma altyapısı.
