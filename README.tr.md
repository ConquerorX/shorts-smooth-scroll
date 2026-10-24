# Shorts Smooth Scroll

<img src="icons/icon128.png" width="88" align="right" alt="Shorts Smooth Scroll ikonu" />

[![Manifest V3](https://img.shields.io/badge/manifest-v3-c00?style=flat-square)](manifest.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-24%20passing-brightgreen?style=flat-square)](#testler)
[![YouTube](https://img.shields.io/badge/verified%20on-youtube.com%2Fshorts-c00?style=flat-square)](#gerçek-sitede-doğrulandı)

[English](README.md) · **Türkçe**

Chromium tabanlı tarayıcılarda (Chrome, Edge, Brave, Opera, Vivaldi) YouTube
Shorts kaydırmasını düzelten küçük bir eklenti.

Bir tekerlek tıkı = tam olarak bir Short. Video atlamak yok, takılmak yok, iki
video arasında gidip gelmek yok.

## Sorun neydi?

Masaüstünde Shorts kaydırması çok tanıdık bir şekilde bozuk hissettiriyor: bazen
hiçbir şey olmuyor, bazen iki video atlıyor, bazen yarı yolda takılıyor. Bu tek
bir yavaş bileşen değil — **üç mekanizmanın aynı kaydırma üzerinde kavga etmesi**:

1. **Chromium'un yumuşak tekerlek animasyonu** tek tıkı pixel bazlı bir
   animasyona çeviriyor.
2. **`scroll-snap-type: y mandatory`** o animasyonun tam ortasında kendi snap
   animasyonunu başlatıp ilkini iptal ediyor.
3. **YouTube'un kendi scroll mantığı** aktif videoyu değiştiriyor ve tüm bunlar
   sürerken yeni bir reel öğesi mount ediyor.

Sonuç: kaydırma konumu hiçbir mekanizmaya ait olmuyor; takılıyor, aşıyor ya da
geri sıçrıyor. Firefox daha iyi hissettiriyor çünkü tekerlek animasyonu ile snap
daha az çakışıyor.

Bu eklenti çakışmayı ayarlamaya çalışmak yerine ortadan kaldırıyor: wheel jestini
devralıyor, kaydırmayı kendisi canlandırıyor ve bu sırada scroll-snap'i geçici
olarak devre dışı bırakıyor.

## Özellikler

- **Deterministik adımlama.** Bir wheel *jesti* tam olarak bir videoya karşılık
  gelir. Chromium tek tıkı bazen tek event, bazen 3–4 küçük event olarak
  gönderiyor; jest makinesi bu bölünmeden etkilenmiyor.
- **Gerçekten akıcı hareket.** Kare hızından bağımsız üstel yaklaşma: kare
  atlandığında süre değil, adım büyüklüğü değişiyor. Taşma veya sıçrama yok.
- **Kesintisiz zincirleme.** Animasyon sürerken yeni jest başlarsa hedef kayıyor;
  hareket durmadan, baştan başlamadan, sıçramadan devam ediyor.
- **Diğer her şeye karışmaz.** İç içe kaydırılabilir alanlar (yorum paneli,
  açıklama), `Ctrl`+tekerlek zoom'u, dokunmatik giriş ve sayfanın geri kalanı
  native davranır.
- **Üç mod, üç hız**, açık Shorts sekmelerine anında uygulanır.
- **Çok dilli arayüz** (Türkçe + İngilizce), `chrome.i18n` ile. Yeni dil eklemek
  için tek klasör yeterli.
- **Ağ erişimi yok, analitik yok, arka plan servisi yok.** `youtube.com` üzerinde
  tek bir content script ve sadece `storage` izni.

## Kurulum

Eklenti Chrome Web Store'da değil — paketlenmemiş olarak yükleniyor.

1. Depoyu klonla veya indir.
2. `chrome://extensions` (`edge://extensions`, `brave://extensions`,
   `opera://extensions`) adresini aç.
3. **Geliştirici modu**nu aç.
4. **Paketlenmemiş öğe yükle** → `manifest.json` dosyasını içeren klasörü seç.
5. Bir Shorts sekmesi aç. Ayar değişiklikleri açık sekmelere anında yansır.

Güncelleme sonrası eklenti kartındaki yenile (⟳) düğmesine bas.

## Ayarlar

Araç çubuğundaki simgeye tıkla:

| Ayar | Değerler | Varsayılan |
| --- | --- | --- |
| **Etkin** | açık / kapalı | açık |
| **Kaydırma modu** | *Tek jest = tek short* / *Akıcı* / *Anında* | tek jest = tek short |
| **Animasyon** | Hızlı (240 ms) / Normal (420 ms) / Yumuşak (620 ms) | Normal |

- **Tek jest = tek short** — her wheel jesti tam olarak bir videoya oturur. Hızlı
  bir fırlatma da tek adım gider; çevirmeye devam edersen adımlar düzenli bir
  tempoda tekrarlanır (klavye tuş tekrarı gibi).
- **Akıcı** — jest boyunca native kaydırma çalışır (snap susturulur), jest bitince
  feed en yakın videoya kayar. Firefox hissine en yakın mod.
- **Anında** — sıfır animasyon. Feed tek karede sonraki/önceki videoya atlar,
  tıpkı `↓` / `↑` tuşlarına basmak gibi. Bu modda animasyon hızı ayarı devre dışı.

Ayarlar `chrome.storage.sync`'te tutulur, Chrome profilinle birlikte taşınır.

## Nasıl çalışıyor?

### Gerçek DOM (Ekim 2026)

```
#shorts-container              <- kaydırma konteyneri, scroll-snap-type: y mandatory
  #shorts-inner-container      <- overflow: visible
    div.reel-video-in-sequence-new   (720px)   <- her Short için bir tane
      #reel-overlay-container
        ytd-reel-video-renderer   <- sadece aktif videonun içinde var
```

Dikkat: `ytd-reel-video-renderer` artık öğe listesi **değil**, yalnızca o an
oynayan Short'un içinde bulunuyor. Bu yüzden eklenti hiçbir tag/sınıf adına
bağlı değil: `ytd-shorts` altındaki en derin kaydırılabilir öğeyi buluyor ve
viewport'un yarısından yüksek çocukları "sayfa" sayıyor (sıfır yükseklikli
template div'leri eleniyor). Bu sayede öğe yüksekliği ile konteyner yüksekliği
farklı olsa bile (canlıda 720 px'e 744 px) kayma olmuyor.

### Kaydırma hattı

```
wheel (capture, passive: false)
  ├─ yoksay: ctrl+tekerlek, imleç altında iç içe scroller, feed dışına tıklama
  ├─ akıcı mod → jest boyunca snap'i sustur, bitince en yakın öğeye hizala
  └─ adım/anında modu → preventDefault
        jest makinesi: 1 jest → 1 adım (30px eşik, 150ms sessizlik,
                        çevirmeye devam ederken 420ms'de bir ek adım)
        hedef: en yakın öğe ofseti + yön (DOM tanınmazsa viewport boyu adım)
        adım modu: x += (hedef - x) * (1 - e^(-λ·dt)), λ = 4560 / süre
        anında modu: scrollTop tek seferde atanır — ara kare hiç oluşmaz
        her karede: scroll-snap + scroll-behavior none, bitince geri alınır
```

Sabit bir easing eğrisi yerine üstel yaklaşma kullanmamızın sebebi:

- **kare hızından bağımsız** (30 fps takılma animasyonu uzatmaz, adımı büyütür);
- uçuş ortasında hedef değişince mevcut hız korunur — zincirlenen jestler durup
  yeniden başlamaz;
- asla taşmaz, yani bir sonraki videonun kenarı görünmez.

### YouTube'un video değişimini atlatmak

YouTube, kaydırma başladıktan ~50-100 ms sonra sıradaki Short'u aktive ediyor ve bu
iş main thread'i ~50-70 ms kilitliyor (tek uzun kare olarak görünür). Kaydırma main
thread'de çalıştığı için, blokajdan sonra gelen kare ışınlanmamalı: kare başına
hareket bir öncekinin 1.2 katıyla sınırlı, böylece blokaj sıçrama değil kısa bir
duraklama oluyor.

Canlı sitede aynı jest için ölçüm:

| | Tek karedeki en büyük hareket |
| --- | --- |
| Sınırlamadan önce | ~176 px |
| Sınırlamadan sonra | ~53 px |

~60 ms'lik blokajın kendisi YouTube oynatıcısına ait ve bu taraftan kaldırılamaz;
gördüğün şey atlama değil, duraklama.

### Gerçek sitede doğrulandı

Canlı `youtube.com/shorts` üzerinde test edildi (Ekim 2026): üç tekerlek tıkı
feed'i `0 → 720 → 1440 → 2160` şeklinde — tam öğe sınırlarına — taşıdı; geri
sıçrama yok, konsol hatası yok.

## Çoklu dil

Tüm arayüz metinleri `_locales/<dil>/messages.json` içinde ve `chrome.i18n`
üzerinden okunuyor; manifest adı ve açıklaması dahil:

```
_locales/
  en/messages.json   (default_locale)
  tr/messages.json
```

Yeni dil eklemek tek klasör + bir `messages.json` kopyası. Popup işaretlemesi
`data-i18n` anahtarlarını kullandığı için kod değişikliği gerekmiyor.

## Testler

```bash
npm install
npm test              # 27 test: birim + DOM e2e + gerçek Chrome'da gerçek eklenti
npm run test:unit     # sadece saf mantık, tarayıcı yok
npm run test:e2e      # fixture sayfası, gerçek tekerlek event'leri
```

| Dosya | Neyi kanıtlıyor |
| --- | --- |
| `test/core.test.js` | Jest makinesi (bölünmüş tık, trackpad birikimi, yön değişimi, tekrar temposu), geometri, lambda/yumuşatma matematiği |
| `test/e2e.test.js` | Canlı Shorts yerleşimini taklit eden DOM'a karşı gerçek tekerlek event'leri: tek tık = tek video, bölünmüş tık iki video değil, hızlı ardışık tıklar atlamıyor, yorum paneli ele geçirilmiyor, akıcı mod hizalanıyor, animasyon tek yönlü ve tam sınıra oturuyor, 90 ms'lik main-thread blokajı sıçramaya dönüşmüyor, uçuş ortasında hedef değişimi zincirleniyor, anında mod iki yönde de tam olarak tek atlama karesi üretiyor |
| `test/extension.test.js` | Paketlenmemiş eklenti gerçek Chrome tarafından yükleniyor, `youtube.com` kaynağında kaydırmayı devralıyor, anında mod orada da tek karede atlıyor, popup çeviriyi ve ayarları doğru işliyor |

Notlar:

- Chrome 137+ `--load-extension` bayrağını kaldırdı; eklenti testi paketlenmemiş
  klasörü DevTools Protocol (`Extensions.loadUnpacked`) ile yüklüyor. Bu da
  Chrome'un manifesti gerçekten parse edip kabul ettiğini doğruluyor.
- Testler `puppeteer-core` ile senin makinendeki Chrome'u kullanıyor
  (`CHROME_PATH` ile değiştirilebilir), yani ikinci bir tarayıcı indirmiyor.

## Proje yapısı

```
manifest.json            MV3 tanımı, i18n anahtarları, ikonlar
_locales/{en,tr}/        arayüz çevirileri
src/core.js              saf mantık: jest makinesi, ofsetler, yumuşatma matematiği
src/content.js           DOM katmanı: keşif, wheel devralma, animasyon, modlar
src/popup.html|.js       ayar arayüzü (çok dilli)
icons/                   üretilmiş PNG'ler
scripts/make-icons.js    ikon üretici (görüntü bağımlılığı yok)
test/                    birim, e2e ve gerçek eklenti testleri + fixture
```

## Hata ayıklama API'si

Herhangi bir Shorts sekmesinin konsolunda:

```js
__shortsSmoothScroll.state()                      // konteyner, öğe sayısı, animasyon durumu
__shortsSmoothScroll.getConfig()                  // { enabled, mode, duration }
__shortsSmoothScroll.configure({ duration: 620 }) // yumuşak
__shortsSmoothScroll.configure({ mode: 'flow' })
__shortsSmoothScroll.configure({ mode: 'jump' })   // anında, animasyonsuz
__shortsSmoothScroll.step(1)                      // programatik tek adım
```

## Sınırlar

- **Dokunmatik ekran ve mobil kapsam dışı.** Wheel event'i yok ve native snap
  orada zaten iyi çalışıyor.
- Klavye gezinmesi (`↑` / `↓`) YouTube'un kendi kontrolünde bırakıldı.
- YouTube tüm konteynerleri yeniden adlandırır ve gerçek scroll konteyneri
  kullanmayı bırakırsa eklenti karışmayı bırakır (`src/content.js` içindeki
  `findScroller` / `findItems` güncellenecek iki yer).
- Uzun Shorts oturumlarındaki bellek şişmesi YouTube'un kendi sorunu; bu eklenti
  video hattını değil kaydırma davranışını değiştirir.

## Sorun giderme

| Belirti | Çözüm |
| --- | --- |
| Açık sekmede hiçbir şey değişmedi | Sekmeyi yenile (`Ctrl`+`R`); content script sadece sayfa yüklenirken enjekte olur |
| Çok yavaş / çok keskin | **Animasyon** ayarını Hızlı / Normal / Yumuşak arasında değiştir |
| Yorum paneli tuhaf davranıyor | Native kalmalı; kalmıyorsa `__shortsSmoothScroll.state()` çıktısıyla issue aç |
| Shorts'ta kaydırma tamamen öldü | Eklentiyi kapatıp doğrula, sekmeyi yenile ve YouTube DOM sürümünü bildir |

## Lisans

[MIT](LICENSE)
