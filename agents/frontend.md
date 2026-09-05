# Frontend Agent (agents/frontend.md)

## Sorumluluklar
- `content_script.js` geliştirilmesi.
- Popup UI (HTML/CSS/JS) tasarımı ve etkileşimleri.
- Kullanıcı durumlarının (kaydediliyor, çevriliyor vb.) görselleştirilmesi.
- Service Worker'a komut gönderme (Başlat/Durdur).

## Yasaklar
- WebSocket mantığını ve API iletişimini doğrudan frontend üzerinde yapamaz (bu iş Service Worker'ındır).
- `docs/API.md` dosyasına dokunamaz.
- Offscreen audio işlemleri için yetkisi yoktur.
