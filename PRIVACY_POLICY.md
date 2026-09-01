# Privacy Policy / Gizlilik Politikası

**Effective Date / Yürürlük Tarihi:** August 29, 2026  
**Last Updated / Son Güncelleme:** August 29, 2026  
**Extension / Eklenti:** oaDub - Gemini Live Simültane Çeviri ve Seslendirme  

---

## 🇹🇷 Türkçe Gizlilik Politikası

### 1. Genel Bakış ve Taahhüt
**oaDub** ("Eklenti", "biz"), kullanıcı gizliliğine ve veri güvenliğine en üst düzeyde önem verir. Bu Gizlilik Politikası, tarayıcı eklentimizi kullanırken hangi verilerin işlendiğini, saklandığını ve üçüncü taraflarla nasıl etkileşim kurulduğunu açıklar.

**Özet Taahhüdümüz:**
- Eklenti geliştiricisi olarak **hiçbir kişisel verinizi, tarama geçmişinizi, ses kayıtlarınızı veya kimlik bilgilerinizi toplamıyor, saklamıyor, profillemiyor veya satmıyoruz.**
- Tüm çeviri ve seslendirme işlemleri doğrudan kullanıcı cihazı ile Google Gemini Live API arasında şifreli ve güvenli bağlantı üzerinden gerçekleşir.

---

### 2. Toplanan ve İşlenen Veriler

#### A. Sekme Ses Verisi (Tab Audio)
- **Kullanım Amacı:** Yalnızca kullanıcının simültane çeviriyi başlattığı sekmedeki ses akışını Gemini Live API'ye aktararak anlık çeviri ve konuşma sentezi (TTS dublaj) üretmek.
- **İşleme Yöntemi:** Ses verisi, tarayıcının `tabCapture` ve `offscreen` API'leri aracılığıyla bellek üzerinde 16-bit PCM (16kHz mono) formatına dönüştürülür ve doğrudan Google'ın resmi Gemini Live WebSocket uç noktasına (`wss://generativelanguage.googleapis.com`) şifreli olarak iletilir.
- **Saklama ve Kayıt:** Ses verisi geliştiriciye ait hiçbir sunucuya **gönderilmez**, yerel diske **kaydedilmez** ve hiçbir sunucuda **depolanmaz**. Çeviri oturumu sonlandırıldığında ses akışı anında yok edilir.

#### B. API Anahtarları (Gemini API Key)
- **Kullanım Amacı:** Google Gemini Live API servislerine kimlik doğrulaması sağlamak.
- **Depolama:** Kullanıcının girdiği API anahtarı (AQ... Auth Key veya AIza... Standard Key), yalnızca kullanıcının kendi tarayıcısındaki yerel depolama alanında (`chrome.storage.local`) saklanır.
- **Güvenlik:** API anahtarı geliştirici sunucularına veya yetkisiz üçüncü taraflara asla iletilmez.

#### C. Kullanıcı Tercihleri ve Ayarları
- **Kapsam:** Hedef dil seçimi, mikser ses seviyeleri (orijinal ses / çeviri sesi) ve seçili model bilgisi.
- **Depolama:** Bu ayarlar yalnızca tarayıcınızın yerel depolamasında (`chrome.storage.local`) tutulur ve cihazınızdan dışarı çıkmaz.

#### D. Canlı Transkript Metinleri
- Canlı transkript metinleri yalnızca oturum süresince popup arayüzünde gösterilmek üzere bellekte tutulur. Eklenti kapatıldığında veya "Temizle" butonuna basıldığında silinir.

---

### 3. Kullanılan Tarayıcı İzinleri (Permissions)

| İzin | Gerekçe ve Kullanım Amacı |
| :--- | :--- |
| `tabCapture` | Kullanıcının aktif sekmesindeki ses akışını yakalayarak çeviri motoruna iletmek için zorunludur. Yalnızca kullanıcı çeviriyi başlattığında devreye girer. |
| `offscreen` | Arka planda Web Audio API işlemlerini ve WebSocket ses akışını tarayıcı performansını düşürmeden yönetmek için kullanılır. |
| `storage` | Kullanıcı tercihlerini (dil, ses seviyeleri) ve API anahtarını kullanıcının yerel tarayıcısında saklamak için kullanılır. |
| `activeTab` | Popup açıldığında yakalanacak sekmenin başlığını ve favicon bilgisini kullanıcıya bilgi amaçlı göstermek için kullanılır. |
| `host_permissions` (`*.googleapis.com`) | Google Gemini Live API WebSocket ve REST uç noktalarına doğrudan güvenli bağlantı kurabilmek için gereklidir. |

---

### 4. Çerezler (Cookies) ve Takip Mekanizmaları
oaDub eklentisi hiçbir çerez (cookie), analitik izleyici (Google Analytics vb.), telemetri aracı, reklam ağı veya üçüncü taraf takip kodu **içermez ve kullanmaz**.

---

### 5. Üçüncü Taraf Hizmetler
Eklenti, kullanıcının kendi temin ettiği API anahtarı aracılığıyla Google Generative AI (Gemini Live API) servisi ile doğrudan iletişim kurar. Bu iletişim Google'ın kendi Gizlilik Politikası ve Hizmet Şartlarına tabidir:
- [Google Privacy Policy](https://policies.google.com/privacy)
- [Google Generative AI Terms of Service](https://ai.google.dev/terms)

---

### 6. Kullanıcı Hakları ve Veri Kontrolü
- Kullanıcı dilediği an çeviriyi durdurabilir, API anahtarını popup arayüzünden silebilir veya eklentiyi kaldırarak yerel cihazdaki tüm verileri temizleyebilir.
- Eklenti hiçbir kullanıcı verisini harici sunucularda tutmadığı için silinmesi gereken uzaktan veri kaydı bulunmamaktadır.

---

### 7. İletişim & Sosyal Medya
Gizlilik politikamızla veya eklentiyle ilgili her türlü soru, öneri ve geri bildiriminiz için bizimle iletişime geçebilirsiniz:
- **Geliştirici:** Onur AKSOY
- **Web Sitesi:** [https://onuraksoy.com.tr](https://onuraksoy.com.tr)
- **E-posta:** [dev@onuraksoy.com.tr](mailto:dev@onuraksoy.com.tr)
- **X (Twitter):** [https://x.com/ooanuraksoy](https://x.com/ooanuraksoy)
- **Instagram:** [https://instagram.com/ooanuraksoy](https://instagram.com/ooanuraksoy)
- **LinkedIn:** [https://linkedin.com/in/ooanuraksoy](https://linkedin.com/in/ooanuraksoy)
- **YouTube:** [https://youtube.com/@ooanuraksoy](https://youtube.com/@ooanuraksoy)
- **GitHub Repository:** [https://github.com/oa/oaDub](https://github.com/oa/oaDub)

---
---

## 🇬🇧 English Privacy Policy

### 1. Overview and Commitment
**oaDub** ("the Extension", "we", "us") places the highest priority on user privacy and data security. This Privacy Policy explains how data is handled, processed, and transmitted when you use our browser extension.

**Our Core Commitment:**
- We **do not collect, store, profile, track, or sell any personal data, browsing history, audio recordings, or identity information.**
- All real-time translation and voice synthesis operations take place directly between your local device and Google Gemini Live API via secure, encrypted connections.

---

### 2. Data Collected and Processed

#### A. Tab Audio Data
- **Purpose:** Captured solely to provide simultaneous interpretation and text-to-speech dubbing from the user-selected active browser tab.
- **Processing Method:** Audio is converted in-memory to 16-bit PCM (16kHz mono) via browser `tabCapture` and `offscreen` APIs and streamed securely via WebSockets directly to Google's official Gemini Live endpoint (`wss://generativelanguage.googleapis.com`).
- **Retention & Storage:** Audio is **never transmitted to any developer server**, is **never saved to disk**, and is **never stored remotely**. The audio stream is immediately discarded when the translation session ends.

#### B. Gemini API Keys
- **Purpose:** Used strictly to authenticate requests with the Google Gemini Live API.
- **Storage:** Your API key (AQ... Auth Key or AIza... Standard Key) is stored exclusively in your browser's local sandbox storage (`chrome.storage.local`).
- **Security:** Your API key is never shared with, sent to, or accessible by developer servers or unauthorized third parties.

#### C. User Preferences & Settings
- **Scope:** Target language selection, volume mixer parameters (original tab audio / translated audio), and selected AI model.
- **Storage:** Retained purely in `chrome.storage.local` on your local device.

#### D. Live Transcript Stream
- Live subtitle and transcript data is kept in transient UI memory for popup display during the session. It is discarded when the extension popup closes or when the "Clear" button is clicked.

---

### 3. Browser Permissions Explained

| Permission | Purpose & Rationale |
| :--- | :--- |
| `tabCapture` | Essential for capturing the audio stream from the current active tab upon explicit user activation. |
| `offscreen` | Required to host background Web Audio API nodes and WebSocket audio pipelines without interrupting browser performance. |
| `storage` | Required to store user settings (target language, audio mixer ratios) and the Gemini API key locally on the user's machine. |
| `activeTab` | Used to display the active tab's title and icon inside the popup header for user convenience. |
| `host_permissions` (`*.googleapis.com`) | Required to establish secure WebSocket and HTTPS connections directly to Google Gemini Live API endpoints. |

---

### 4. Cookies & Tracking
oaDub contains **no cookies, no analytics SDKs, no telemetry frameworks, no advertising trackers, and no third-party profiling scripts**.

---

### 5. Third-Party Services
The extension communicates directly with Google's Gemini Live API using your personal API key. Interactions with Google services are governed by Google's Privacy Policy and Terms of Service:
- [Google Privacy Policy](https://policies.google.com/privacy)
- [Google Generative AI Terms of Service](https://ai.google.dev/terms)

---

### 6. User Rights and Data Control
- You can stop translation sessions at any moment.
- You can delete your saved API key and reset preferences at any time directly through the popup interface or by removing the extension.
- Since we do not maintain external databases or user accounts, no remote data exists to be deleted.

---

### 7. Contact Information & Social Media
If you have any questions or feedback regarding this Privacy Policy, please reach out to:
- **Developer:** Onur AKSOY
- **Website:** [https://onuraksoy.com.tr](https://onuraksoy.com.tr)
- **Email:** [dev@onuraksoy.com.tr](mailto:dev@onuraksoy.com.tr)
- **X (Twitter):** [https://x.com/ooanuraksoy](https://x.com/ooanuraksoy)
- **Instagram:** [https://instagram.com/ooanuraksoy](https://instagram.com/ooanuraksoy)
- **LinkedIn:** [https://linkedin.com/in/ooanuraksoy](https://linkedin.com/in/ooanuraksoy)
- **YouTube:** [https://youtube.com/@ooanuraksoy](https://youtube.com/@ooanuraksoy)
- **GitHub Repository:** [https://github.com/oa/oaDub](https://github.com/oa/oaDub)
