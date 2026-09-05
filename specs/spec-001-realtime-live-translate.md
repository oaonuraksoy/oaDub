# spec-001: Realtime Live Translate

## Genel Bakış
Gemini Live Translate API entegrasyonu kullanılarak uçtan uca gecikmenin (latency) minimize edilmesi hedeflenmektedir.

## Gereksinimler
- **Gecikme Azaltma:** Ses yakalama ve oynatma arasındaki toplam süre 500ms altında tutulmalıdır.
- **Chunking:** Mikrofon verisi 100ms'lik (veya daha küçük) raw PCM (16kHz, 16-bit, mono) chunk'lar halinde parçalanmalıdır.
- **translationConfig:** API isteğinde `systemInstruction` yerine `generationConfig.translationConfig` kullanılmalıdır, bu sayede Live Translate modeli tetiklenecektir.
- **Jitter Buffer:** Oynatım sırasında dalgalanmaları önlemek için 50-100ms'lik dinamik jitter buffer toleransları uygulanmalıdır.
