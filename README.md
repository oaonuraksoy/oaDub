# 🎙️ oaDub - Gemini Live Simültane Çeviri ve Seslendirme Eklentisi (Manifest V3)

[![Microsoft Edge Add-ons](https://img.shields.io/badge/Microsoft_Edge_Add--ons-Ücretsiz_İndir-0078D7?style=for-the-badge&logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/oadub-gemini-live-sim%C3%BCl/cpnkpahbhcdbhhgacmnnobbieedaacgb)
[![GitHub Release](https://img.shields.io/github/v/release/oaonuraksoy/oaDub?style=for-the-badge&color=00b894)](https://github.com/oaonuraksoy/oaDub/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**oaDub**, Google Chrome ve Chromium tabanlı tüm tarayıcılarda (Edge, Brave, Opera) açık olan herhangi bir sekmedeki (YouTube, Coursera, Udemy, Twitch, podcast'ler veya canlı yayınlar) ses akışını yakalayan, **Google Gemini 3.5 Live Multimodal Bi-directional WebSocket API** üzerinden simültane olarak hedef dile çeviren ve anında dublajlayarak seslendiren yeni nesil bir tarayıcı eklentisidir.

---

> ### 🌟 Mağazadan İndirin & 5 Yıldızla Destek Olun!
> **oaDub** tamamen ücretsiz ve açık kaynaklıdır. Projeyi hemen kullanmaya başlamak ve otomatik güncellemelerden yararlanmak için resmi mağazadan indirebilirsiniz:
>
> 📥 **[Microsoft Edge & Chromium Eklenti Mağazasından İndir](https://microsoftedge.microsoft.com/addons/detail/oadub-gemini-live-sim%C3%BCl/cpnkpahbhcdbhhgacmnnobbieedaacgb)**  
>
> 💖 *Eğer eklenti işinize yaradıysa, lütfen mağazada **5 Yıldız verip yorum bırakarak** ve GitHub'da **⭐ Star** atarak projeyi desteklemeyi unutmayın!*

---

## 🌟 Öne Çıkan Özellikler

- ⚡ **Gemini 3.5 Live Bi-directional WebSocket:** Düşük gecikmeli (low-latency) çift yönlü PCM ses akışı (16.000 Hz Little-Endian Mono PCM girdi -> 24.000 Hz Mono PCM çıktı).
- 🎙️ **Kayıpsız Sekme Sesi Yakalama:** `chrome.tabCapture` API ve Chrome Manifest V3 Offscreen Document mimarisi ile sekme sesi arka planda kesintisiz yakalanır.
- 🎚️ **Bağımsız Çift Kanallı Ses Mikseri (Audio Mixer):**
  - **Orijinal Sekme Sesi:** %0 ile %100 arasında ayarlanabilir passthrough kazanç kontrolü.
  - **Çeviri Dublaj Sesi:** %0 ile %100 arasında ayarlanabilir yapay zeka ses seviyesi.
- 💬 **Canlı Transkript & Dublaj Akışı:** Gerçek zamanlı transkript akışı paneli, tek tıkla panoya kopyalama ve temizleme desteği.
- 🛡️ **%100 Güvenli & Yerel Depolama:** API anahtarınız hiçbir sunucuya iletilmez, yalnızca tarayıcınızın yerelinde (`chrome.storage.local`) saklanır.
- 🌐 **14+ Dil Desteği:** Türkçe, İngilizce, Almanca, İspanyolca, Fransızca, İtalyanca, Japonca, Rusça, Çince, Arapça, Portekizce, Felemenkçe, Korece, Hintçe.
- 🎨 **Modern Dark Glassmorphism Arayüz:** Durum rozetleri, animasyonlu canlı kayıt indikatörü ve kısayol tuşu (**Alt + Shift + D**).

---

## 🚀 Kurulum Seçenekleri

### Yöntem 1: Eklenti Mağazasından Tek Tıkla Yükleme (Önerilen)
1. **[Microsoft Edge Eklenti Mağazası](https://microsoftedge.microsoft.com/addons/detail/oadub-gemini-live-sim%C3%BCl/cpnkpahbhcdbhhgacmnnobbieedaacgb)** sayfasına gidin.
2. **"Al" / "Yükle"** butonuna tıklayın.
3. Eklenti saniyeler içinde tarayıcınıza kurulacak ve otomatik güncelleme alacaktır. *(Edge, Chrome, Brave ve tüm Chromium tarayıcılarda çalışır)*.

---

### Yöntem 2: GitHub Releases (.zip) ile Manuel Yükleme
1. [GitHub Releases](https://github.com/oaonuraksoy/oaDub/releases) sayfasından en son `oaDub-v1.0.2.zip` dosyasını indirin ve bir klasöre çıkartın.
2. Tarayıcınızda `chrome://extensions/` veya `edge://extensions/` adresine gidin.
3. **"Geliştirici modu" (Developer mode)** anahtarını aktif edin.
4. **"Paketlenmemiş öğe yükle" (Load unpacked)** butonuna tıklayın ve çıkarttığınız klasörü seçin.

---

### Yöntem 3: Açık Kaynak Geliştiriciler & Remixleyenler İçin
```bash
git clone https://github.com/oaonuraksoy/oaDub.git
```
Repoyu klonladıktan sonra dilediğiniz gibi düzenleyebilir, kendi API/UI mantığınızı ekleyebilir ve geliştirici modunda doğrudan test edebilirsiniz.

---

## 📁 Proje Dosya Yapısı

```
oaDub/
├── manifest.json              # Chrome Manifest V3 yapılandırma dosyası
├── background/
│   └── service_worker.js     # Arka plan servis çalışanı ve yaşam döngüsü yöneticisi
├── offscreen/
│   ├── offscreen.html        # Web Audio ve WebSocket için Offscreen DOM ortamı
│   └── offscreen.js          # 16kHz PCM yakalama, Gemini Live WS ve 24kHz ses oynatma
├── popup/
│   ├── popup.html            # Glassmorphism kullanıcı arayüzü
│   ├── popup.css             # Koyu tema, animasyonlar ve stil tanımları
│   └── popup.js              # Arayüz mantığı, ayar kalıcılığı ve mesajlaşma
├── scripts/
│   └── content_script.js     # Sayfa içi yardımcı betikler
├── icons/
│   ├── icon.svg              # Vektörel logo
│   ├── icon16.png            # 16x16 eklenti ikonu
│   ├── icon48.png            # 48x48 eklenti ikonu
│   └── icon128.png           # 128x128 eklenti ikonu
├── assets/
│   └── store/                # Tanıtım ve mağaza görsel materyalleri
├── PRIVACY_POLICY.md         # Gizlilik politikası ve veri güvenliği
└── README.md                 # Kurulum ve kullanım kılavuzu
```

---

## 🔑 Kullanım Kılavuzu

1. **API Anahtarı Temini:**
   - [Google AI Studio](https://aistudio.google.com/app/apikey) adresinden bir Gemini API Anahtarı edinin.
2. **Eklentiyi Başlatma:**
   - Çevirisini dinlemek istediğiniz bir video, podcast veya canlı yayın sekmesini açın (örneğin İngilizce bir YouTube videosu).
   - Chrome araç çubuğundaki **oaDub** simgesine tıklayarak açılır pencereyi açın.
   - **Gemini API Anahtarı** alanına anahtarınızı yapıştırın (anahtarınız `chrome.storage.local` üzerinde güvenle yerel olarak saklanır).
   - **Hedef Dil** (örn. 🇹🇷 Türkçe) ve **Gemini Modeli** (`Gemini 3.5 Live`) seçimini yapın.
   - **Ses Mikseri** üzerinden orijinal sekme sesini (örn. %20) ve dublaj sesini (örn. %100) dilediğiniz gibi ayarlayın.
   - **"Simültane Çeviriyi Başlat"** butonuna basın.
3. **Canlı İzleme:**
   - Canlı transkript akışında çevrilen konuşmaları metin olarak anlık takip edebilirsiniz.
   - **"Kopyala"** butonu ile tüm metni panoya kopyalayabilir, **"Temizle"** ile sıfırlayabilirsiniz.
4. **Durdurma:**
   - Çeviriyi durdurmak için **"Simültane Çeviriyi Durdur"** butonuna basmanız yeterlidir.

---

## 🛠️ Teknik Özet

- **İstemci -> Gemini (Giriş):** `audio/pcm;rate=16000` (16-bit Mono Little-Endian PCM, ~150ms aralıklarla Base64 kodlanmış paketler).
- **Gemini -> İstemci (Çıkış):** `audio/pcm;rate=24000` (24kHz Mono 16-bit PCM, `AudioBufferSourceNode` ile takılmasız zamanlanmış çalma).
- **İletişim:** `chrome.runtime.sendMessage` ve `chrome.offscreen` dokümanı üzerinden çift yönlü mesajlaşma.

---

## 👨‍💻 Geliştirici & Sosyal Medya (Developer & Socials)

- **Geliştirici:** Onur AKSOY
- **Web Sitesi:** [https://onuraksoy.com.tr](https://onuraksoy.com.tr)
- **E-posta:** [dev@onuraksoy.com.tr](mailto:dev@onuraksoy.com.tr)
- **X (Twitter):** [@ooanuraksoy](https://x.com/ooanuraksoy)
- **Instagram:** [@ooanuraksoy](https://instagram.com/ooanuraksoy)
- **LinkedIn:** [Onur AKSOY](https://linkedin.com/in/ooanuraksoy)
- **YouTube:** [@ooanuraksoy](https://youtube.com/@ooanuraksoy)

---

## 📄 Lisans
MIT License - Geliştirmeye ve katkılara açıktır.
