# DESIGN.md: ismailtarim.dev

Kişisel site: portföy, proje vitrini, saha notları (başka yerde yazılı olmayan bulgular) ve denemeler.
Okuyucular: işe alımcılar (30 saniyelik tarama), arama yapan mühendisler, arama motorları ve LLM tarayıcıları.

Seçimler 2026-10-30 tarihinde yapıldı.
Bu dosya kararların tek yeridir; koddaki renk, font ve ölçüler buradaki token'lardan türer.

## Genel yön: terminal, okunur gövde

- Koyu öncelikli kimlik, ama metin rahat okunur: gövde sans-serif.
- Monospace yalnız komut, kod, tarih, commit hash ve isim yazımında.
- Sıcak vurgu rengi tek rolde: bağlantı alt çizgisi ve upstream rozetleri.
- Saf siyah zemin yok; koyu arduvaz.

## Yazı tipi

| Rol | Aile | Not |
|---|---|---|
| Başlık | IBM Plex Sans, 600 | `text-wrap: balance` |
| Gövde | IBM Plex Sans, 400 | 17-18px, satır ~65 karakter, line-height 1.6 |
| Kod, tarih, hash, isim yazımı | IBM Plex Mono, 400/500 | |

Fallback: `system-ui, sans-serif` ve `ui-monospace, monospace`. Fontlar siteyle birlikte barındırılır (Google Fonts'a istek yok).

## Renk: çekirdek kehribarı

```css
:root {
  --bg: #F5F5F1;
  --fg: #1C1B18;
  --muted: #615D54;
  --accent: #9A5A00;
  --rule: #DEDBD2;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #171A1F;
    --fg: #E9E6DE;
    --muted: #A39E93;
    --accent: #F2A93B;
    --rule: #2E323A;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] { /* aynı koyu değerler */ }
```

Açık ve koyu temada kontrast, kurulumda WCAG AA'ya karşı ölçülecek (henüz ölçülmedi).

## Tema

Sistem tercihine uyar; köşede elle değiştirme düğmesi, seçim tarayıcıda hatırlanır.

## İsim yazımı ve favicon

- Başlıkta `~/ismail`, Plex Mono 500; `~/` vurgu renginde.
- Favicon: `~/`, vurgu renginde, 16 ve 32 px; açık ve koyu sekmede okunur olmalı.

## Menü ve altbilgi

- Başlıkta tam yol: `~/ismail/projects/stox`; her parça tıklanır.
- Üst menü her sayfada: Projects, Notes, Writing, Awards, About, dil seçici ve tema düğmesi. O dilde yayını olmayan Notes ve Writing menüde görünmez.
- Altbilgi: RSS, GitHub, LinkedIn, e-posta, telif satırı.

## Tek ızgara ve tek liste

Üst menü, içerik ve altbilgi 900 px genişlikte. İçerik iki izli: solda 172 px bilgi sütunu (tarih, yıl, durum, sonuç, rol), sağda iş. Projeler, notlar, ödüller aynı `.entry` satırını kullanır; yazı, proje ve About sayfalarında bilgiler sol sütunda durur. Dar ekranda tek sütun. Bölüm başlıkları gövdeden güçlüdür, üstlerinde ince çizgi vardır.

## Ana sayfa ve About

İçerik panelden gelir (`#/profile`, `#/projects`); dile göre bir profil satırı vardır. Ana sayfa: fotoğraf (yoksa hiç çizilmez), isim, tek satır tanıtım, gövdenin yalnız ilk paragrafı, konum ve bağlantılar, rozetler, "Selected projects" (panelde "Show on home page" işaretli projeler; yoksa bölüm yok), son dört yazı/not. Gövdenin tamamı `/about`'tadır.

Gövdesi boş profil çizilmez: İngilizce profil yoksa eski ana sayfa (iki cümlelik tanıtım, son yazılar, proje tablosu) aynen gösterilir. `/tr` ve `/tr/about`, kendi profili yoksa İngilizce profili gösterir; bu durumda noindex olur ve hreflang bulunmaz (`/tr/projects` ile aynı kural). Hiç profil yoksa `/about` ana sayfaya 301 yapar.

## Saha notu biçimi: kısa cevap + hikâye

1. Başlık birebir problem cümlesi.
2. En üstte kutu: **Symptom** (birebir hata metni) ve **Fix**.
3. Altında serbest anlatı: nasıl bulundu, neden oluyor.
4. Her notta doğrulandığı ortam ve tarih (sürümler, dağıtım).

## Yazı sayfası: kenar notlu

Ana sütun ~65 karakter, kenar notları sağ boşlukta; dar ekranda satır içine açılır.

## Kod blokları: dosya adlı çerçeve

Üst şeritte dosya adı ya da kabuk, sağda kopyala düğmesi; zemin tema rengi (her temada koyu değil).

## Bağlantılar

Metin içi ve eylem bağlantıları metin renginde, alt çizgi vurgu renginde ve 2px, `text-underline-offset: 3px`. Liste başlıkları, üst menü ve altbilgi çizgisizdir; üzerine gelince çizgi çıkar, menüde geçerli sayfa çizgilidir. Odak halkası her zaman görünür.

## Görseller ve şekiller

- Öncelik SVG diyagram; tema token'larını kullanır, iki temada renk değiştirir.
- Ekran görüntüsü ya da çıktı gerektiğinde kenarlı, numaralı şekil.
- İkisi de "Fig. N" numarası alır ve metinden numarayla atıf yapılır.

## Proje vitrini: kanıt tablosu + vaka çalışması

- Projects sayfası tek liste dilinde: solda yıl ve durum (merged, under review, submitted, personal tool), sağda iş, ilgili ödül veya katkının sonucu, kanıt bağlantısı.
- Durumlar dürüst: merge edilmemiş iş merged görünmez.
- Önemli projelerin satırı vaka çalışması sayfasına açılır: problem, kararlar, ölçüm, ders. Sol sütunda yıl, durum, rol, ekip, sonuç; altta ilgili ödül, katkı ve yazı.

## İmza öğesi: upstream rozetleri

Kernel yamaları ve PR'lar commit hash ve sürüm rozetleriyle gösterilir; her rozet lore.kernel.org, git.kernel.org ya da GitHub kaydına bağlanır. Sitedeki tek "akılda kalan" öğe bu; başka süs eklenmez.

## Paylaşım görseli (OG), sayfa türüne göre

| Sayfa | Kart |
|---|---|
| Saha notu | Birebir hata satırı üstte, başlık altında |
| Deneme, proje | Tür + tarih, başlık, site adı |
| Ana sayfa, About | İsim kartı |

Panelde Save sırasında tarayıcıda çizilir ve R2'ye yüklenir, 1200x630; yalnız kart metni değişince yeniden üretilir. Kartı olmayan sayfa site kartını kullanır.

## Hareket

Yalnız eyleme tepki: kenar notu açılması, kopyalandı onayı. Sayfa yüklenirken animasyon yok. `prefers-reduced-motion`'da geçişler kapanır.

## Dil

Notlar ve projeler İngilizce. Bazı denemeler yalnız Türkçe, dil etiketiyle (`lang="tr"`); çeviri zorunlu değil.

## Sabit kurallar

- Vurgu rengi yalnız bağlantı çizgisinde ve upstream rozetlerinde.
- Klavye odağı her zaman görünür.
- Telefon genişliğinde yatay kaydırma yok; kod ve tablolar kendi kutusunda kayar.
- Çalıştığım şirketlerin iç metrikleri sitede yer almaz.
- Tanıtım ve About metinleri İsmail'in kendi sesiyle.
