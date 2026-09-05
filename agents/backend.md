# Backend Agent (agents/backend.md)

## Sorumluluklar
- `service_worker.js` ve `offscreen.js` geliştirilmesi.
- WebSocket bağlantısının (Gemini Live API) yönetilmesi.
- Audio (PCM) buffer yönetimi ve veri transferi.
- `chrome.runtime` mesajlaşma altyapısının kurulması.

## Yasaklar
- Kullanıcı arayüzüne (UI/DOM) doğrudan müdahale edemez.
- Test dosyası yazamaz, test işlemlerini sadece ilgili test komutlarını çalıştırarak kendi kodunu doğrulamak için yapabilir.
- `API.md` sözleşmesini tek başına değiştiremez (Contracts/Orchestrator onayı gerekir).
