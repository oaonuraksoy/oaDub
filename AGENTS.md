# AGENTS.md — Orkestra Anayasası ve Ajan Rolleri

Bu dosya `GEMINI.md` çerçevesinde tanımlanan alt ajanların rollerini, yetkilerini ve Chrome MV3 eklentisi içindeki ses pipeline kurallarını belirler.

## Roller
- **Orkestratör (Claude Sonnet / Gemini Pro):** Görev dağılımı, rapor değerlendirme, onay mekanizması.
- **Backend Developer (Gemini 3.7 Flash):** service_worker.js, offscreen.js, WebSocket yönetimi.
- **Frontend Developer (Gemini 3.7 Flash):** UI/UX, content_script.js entegrasyonu, popup UI.
- **Tester Agent (Gemini 3.7 Flash):** Gecikme testi, uçtan uca ses testi, API testleri.
- **Auditor Agent (Gemini 3.1 Pro):** Mimari kararların analizi, güvenlik, MV3 uyumu.

## Ses Pipeline Kuralları
- **PCM Chunking:** Ses verileri 100ms'lik chunk'lar halinde gönderilir.
- **Jitter Buffer:** Ağ dalgalanmalarına karşı tolerans için kullanılır.
- **Live Translate:** systemInstruction yerine translationConfig kullanılmalıdır.
