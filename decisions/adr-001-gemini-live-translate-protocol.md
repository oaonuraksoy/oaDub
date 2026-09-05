# ADR-001: Gemini Live Translate Protokolü

## Karar
Gemini Multimodal Live API üzerinden canlı çeviri için `systemInstruction` yerine `generationConfig.translationConfig` kullanılacaktır. Ses gönderimi 100ms'lik PCM chunk'lar halinde yapılacaktır.

## Gerekçe
- `systemInstruction` genel amaçlı promptlar içindir, Live Translate'in özel model optimizasyonlarını tetiklemez. `translationConfig` daha düşük gecikme ve daha yüksek çeviri isabeti sunar.
- 100ms PCM chunking, hem ağ trafiğini verimli kullanmak hem de server-side VAD (Voice Activity Detection) algoritmalarının düzgün çalışması için optimal değerdir. Daha büyük boyutlar gecikmeyi artırır.

## turnComplete Yönetimi
- Sunucudan dönen `turnComplete` mesajı, o anki çevirinin veya cümlenin bittiğini işaret eder. Oynatım kuyruğunun temizlenmesi ve sonraki akışa hazırlanması için bu event dinlenecek ve oynatma düzeltmesi buna göre yapılacaktır.
