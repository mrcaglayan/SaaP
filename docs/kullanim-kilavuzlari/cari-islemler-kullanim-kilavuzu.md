# Cari İşlemler (Current Accounts) Kullanım Kılavuzu

Bu kılavuz, uygulamayı kullanan finans, muhasebe ve operasyon ekipleri içindir. Teknik geliştirme detayı içermez.

## 1. Kapsam

Bu doküman aşağıdaki Cari modül ekranlarının kullanımını açıklar:

- `Alıcı Kartı Oluştur (Alici Karti Olustur)`
- `Alıcı Kartı Listesi (Alici Karti Listesi)`
- `Satıcı Kartı Oluştur (Satici Karti Olustur)`
- `Satıcı Kartı Listesi (Satici Karti Listesi)`
- `Cari Raporları (Cari Reports)`

Ayrıca ödeme koşulu hazırlığı, günlük kullanım, ay sonu kullanımı ve sık hatalar için pratik öneriler içerir.

## 2. Kısa Sözlük

- `Counterparty (Cari Kart)`: Müşteri, tedarikçi veya ikisi birden olabilen ticari hesap kartı.
- `Customer (Müşteri / Alıcı)`: Sizden tahsilat beklediğiniz taraf.
- `Vendor (Tedarikçi / Satıcı)`: Sizin ödeme yaptığınız taraf.
- `Payment Term (Ödeme Koşulu)`: Vade kuralı. Örn. Net 30.
- `AR Aging (Alacak Yaşlandırma)`: Tahsil edilmesi gereken alacakların vade durumunu gösterir.
- `AP Aging (Borç Yaşlandırma)`: Ödenecek borçların vade durumunu gösterir.
- `Open Items (Açık Kalemler)`: Henüz kapanmamış (tam tahsil/ödeme olmamış) kalemler.
- `Counterparty Statement (Cari Ekstre)`: Belirli bir cari için belge, mahsup/tahsilat ve bakiye hareket özeti.
- `As-Of Date (Kesit Tarihi)`: Raporun “bu tarih itibarıyla” görünmesini sağlayan tarih.

## 3. Başlamadan Önce

Cari modülünü sorunsuz kullanmak için aşağıdakiler hazır olmalıdır:

1. Yetkiler atanmış olmalı:
- `cari.card.read`
- `cari.card.upsert`
- `cari.report.read`

2. Şirket/organizasyon temel kurulumu yapılmış olmalı:
- `Ayarlar > Şirket Ayarları (Sirket Ayarlari)` içindeki `Run Company Bootstrap` veya
- `Ayarlar > Organizasyon Yönetimi (organizasyon-yonetimi)` ile şirket/elverişlilik kayıtları.

3. İlgili `Legal Entity (Yasal Şirket)` için en az bir `Payment Term (Ödeme Koşulu)` olmalı.
- Ödeme koşulu yoksa kart ekranındaki varsayılan ödeme koşulu alanı boş kalır.

## 4. Menüden Erişim

- `Cari İşlemler > Alıcı Kartı Oluştur`
- `Cari İşlemler > Alıcı Kartı Listesi`
- `Cari İşlemler > Satıcı Kartı Oluştur`
- `Cari İşlemler > Satıcı Kartı Listesi`
- `Cari İşlemler > Cari Raporları`

## 5. Alıcı Kartı Oluştur (Alici Karti Olustur)

### Ne zaman kullanılır?

- Yeni müşteri ile çalışmaya başladığınızda.
- Müşteri bilgileri, vade ve iletişim verisi güncelleneceğinde.

### Neden önemlidir?

- Tahsilat planı, yaşlandırma raporu ve cari ekstre bu karta bağlıdır.
- Yanlış kart bilgisi tahsilat takibini zorlaştırır.

### Adım adım kullanım

1. `Legal Entity` seçin.
2. `Code` ve `Name` girin.
3. Rol alanında `Customer` işaretli olmalı.
4. Gerekliyse `Default Currency` ve `Default Payment Term` seçin.
5. İletişim (`Contacts`) ve adres (`Addresses`) girin.
6. Ana iletişim/adres için `isPrimary` işaretleyin.
7. `Save` ile kaydedin.

### Gerçek hayat örneği

Durum:
- ABC Dağıtım adlı yeni bir müşteri ile çalışmaya başlandı.
- Standart vade: Net 30 gün.

Yapılacak:
- `Alıcı Kartı Oluştur` ekranında:
  - `Code`: `ABC_DIST`
  - `Name`: `ABC Dagitim`
  - `Default Payment Term`: `NET30`
  - Ana e-posta ve fatura adresi girilir.

Beklenen sonuç:
- Bu müşteriye ait ileride oluşacak alacaklar `AR Aging` ve `Counterparty Statement` raporlarında doğru görünür.

## 6. Satıcı Kartı Oluştur (Satici Karti Olustur)

### Ne zaman kullanılır?

- Yeni tedarikçi ile satın alma/ödeme süreci başlamadan önce.

### Neden önemlidir?

- Vadesi gelen borçları (`AP Aging`) doğru yönetebilmek için satıcı kartının doğru olması gerekir.

### Adım adım kullanım

1. `Legal Entity` seçin.
2. `Code` ve `Name` girin.
3. Rol alanında `Vendor` işaretli olmalı.
4. Varsa `Default Payment Term` seçin.
5. İletişim ve adres bilgilerini ekleyin.
6. Kaydedin.

### Gerçek hayat örneği

Durum:
- XYZ Ambalaj’dan düzenli malzeme alınıyor.
- Ödeme koşulu Net 45.

Yapılacak:
- `Satıcı Kartı Oluştur` ekranında `Vendor` kartı açılır, `NET45` atanır.

Beklenen sonuç:
- Borç vadesi `AP Aging` raporunda doğru bucket’a düşer ve ödeme planı doğru yapılır.

## 7. Kart Listeleri ve Kart Güncelleme

Ekranlar:
- `Alıcı Kartı Listesi`
- `Satıcı Kartı Listesi`

### Ne yapılır?

- Kart arama (`q`), durum (`ACTIVE/INACTIVE`), şirket (`Legal Entity`) ve rol filtresi.
- Kart detayını açıp güncelleme.

### Ne zaman kartı pasif (`INACTIVE`) yapmalıyım?

- Cari ile çalışmıyorsanız ve yeni işlem açılmasını istemiyorsanız.
- Geçmiş kayıtlar korunur, raporlar geçmişi görmeye devam eder.

### Gerçek hayat örneği

Durum:
- Eski tedarikçi ile çalışma tamamen bitti.

Yapılacak:
- `Satıcı Kartı Listesi` > ilgili kart > `Status = INACTIVE`.

Sonuç:
- Operasyonel listelerde aktif satıcılar sadeleşir, yanlış seçim riski azalır.

## 8. Cari Raporları (Cari Reports)

Rapor ekranında ana filtreler:

- `As-Of Date (Kesit Tarihi)`
- `Legal Entity`
- `Counterparty`
- `Role (CUSTOMER/VENDOR/BOTH)`
- `Status`

En kritik filtre: `As-Of Date`.
Bu tarih değiştiğinde rapor sonucu da değişir. Ay kapanışı, geçmiş tarih doğrulaması ve denetim için mutlaka bu alan bilinçli kullanılmalıdır.

### 8.1 AR Aging (Alacak Yaşlandırma)

Soru:
- “Hangi müşteriden ne kadar alacağım var, ne kadarı gecikmiş?”

Ne zaman kullanılır?
- Günlük tahsilat toplantısı.
- Haftalık alacak risk değerlendirmesi.

Nasıl yorumlanır?
- `CURRENT`: vadesi gelmemiş.
- `1-30`, `31-60`, `61-90`, `91+`: gecikme arttıkça risk artar.

Gerçek hayat örneği:
- 91+ günde biriken müşteri kalemleri için satış + finans birlikte aksiyon planı yapar:
  - yeni sevkiyat limiti,
  - ödeme planı,
  - telefon/e-posta takibi.

### 8.2 AP Aging (Borç Yaşlandırma)

Soru:
- “Hangi satıcıya ne kadar, ne zaman ödeme yapmalıyım?”

Ne zaman kullanılır?
- Haftalık ödeme planı.
- Nakit çıkış planlaması.

Gerçek hayat örneği:
- Önümüzdeki hafta nakit kısıtlıysa:
  - önce vadesi geçen kritik tedarikçilere ödeme,
  - sonra CURRENT kalemler için yeni tarih planlama.

### 8.3 Open Items (Açık Kalemler)

Soru:
- “Hangi belgeler tamamen kapanmamış?”

Ne zaman kullanılır?
- Mutabakat öncesi.
- Kısmi tahsilat/ödeme sonrası kalan bakiye kontrolünde.

Neye bakılır?
- `residual/open balance (kalan açık bakiye)`
- `partially settled (kısmi kapanmış)` kalemler
- varsa banka bağlantı bilgisi (`bank-link`) ve referanslar

Gerçek hayat örneği:
- Bir faturanın %70’i tahsil edildi.
- `Open Items`’ta kalan %30 bakiye açık kalem olarak görünür.
- Tahsilat ekibi sadece kalan kısım için takip yapar.

### 8.4 Counterparty Statement (Cari Ekstre)

Soru:
- “Bu cari ile hangi belgeler ve kapanış hareketleri olmuş, kalan durum nedir?”

Ne zaman kullanılır?
- Cari mutabakatı gönderirken.
- “Bu bakiye neden böyle?” sorusuna cevap verirken.

Neye bakılır?
- Belge satırları (fatura vb.)
- Kapanış/mahsup bağlantıları
- Ters kayıt etkileri (reversal)
- Toplamların mutabakatı

Gerçek hayat örneği:
- Müşteri “bu fatura zaten kapandı” diyor.
- `Counterparty Statement` üzerinden ilgili belge ve ona bağlı kapanış bağlantısı gösterilir.
- Gerekirse ters kayıt tarihleriyle birlikte açıklama yapılır.

## 9. Ödeme Koşulu (Payment Term) Yönetimi

### 9.1 Varsayılan koşulları toplu oluşturma

Ekran:
- `Ayarlar > Şirket Ayarları` içindeki `Run Company Bootstrap`.

Ne sağlar?
- Kurulum sırasında şirketler için varsayılan ödeme koşulları da oluşturulur.

### 9.2 Organizasyon Yönetimi üzerinden

Ekran:
- `Ayarlar > Organizasyon Yönetimi`.

Kritik seçenekler:
- `autoProvisionDefaults`: Açık ise varsayılan ödeme koşulları otomatik oluşturulur.
- `Use custom payment terms (JSON)`: Açılırsa şirkete özel ödeme koşulları yüklenir.

Örnek özel ödeme koşulu JSON:

```json
[
  {
    "code": "NET30",
    "name": "Net 30",
    "dueDays": 30,
    "graceDays": 0,
    "isEndOfMonth": false,
    "status": "ACTIVE"
  },
  {
    "code": "NET45",
    "name": "Net 45",
    "dueDays": 45,
    "graceDays": 0,
    "isEndOfMonth": false,
    "status": "ACTIVE"
  }
]
```

Ne zaman custom kullanılır?
- Farklı ülkelerde farklı vade yapıları varsa.
- Grup standartlarından ayrışan şirket politikası varsa.

## 10. Günlük, Haftalık, Aylık Pratik Kullanım Akışı

### Günlük

1. `AR Aging` aç, gecikmiş müşteri kalemlerini filtrele.
2. `Open Items` ile bugün kapanması beklenen kalemleri kontrol et.
3. Önemli müşteri/satıcı kart güncellemelerini listelerden yap.

### Haftalık

1. `AP Aging` ile haftalık ödeme listesi çıkar.
2. `Counterparty Statement` ile büyük cari hesapları mutabakata hazırla.
3. Pasif edilmesi gereken eski cari kartları gözden geçir.

### Ay sonu

1. `As-Of Date` ay sonu tarihi seçilerek tüm raporları tekrar çalıştır.
2. `Open Items` toplamları ile `Statement` toplamlarını karşılaştır.
3. Kritik farkları cari bazında ekstreye inerek çöz.

## 11. Sık Karşılaşılan Durumlar ve Çözüm

### “Varsayılan ödeme koşulu listesi boş”

Neden:
- İlgili `Legal Entity` için ödeme koşulu yoktur.

Çözüm:
- `Run Company Bootstrap` çalıştırın veya
- `Organizasyon Yönetimi` ekranında `autoProvisionDefaults` ile yeniden provisioning yapın.

### “Rapor beklediğimden farklı çıktı”

Kontrol listesi:
1. `As-Of Date` doğru mu?
2. `Legal Entity` filtresi doğru mu?
3. `Role` ve `Status` filtreleri doğru mu?

### “Bu kartı herkes göremiyor”

Neden:
- Kullanıcının yetki/scope (kapsam) ataması sınırlı olabilir.

Çözüm:
- Sistem yöneticisinden ilgili role uygun yetki ve şirket kapsamı atamasını isteyin.

## 12. İyi Kullanım Önerileri

- Kodları (`Code`) standartlaştırın: örn. `MUSTERI_` veya `TEDARIKCI_` önekleri.
- Her kartta en az bir güncel iletişim ve birincil adres tutun.
- Pasif kartları silmek yerine `INACTIVE` yapın.
- Rapor yorumlarken her zaman `As-Of Date` bilgisini not edin.
- Mutabakat süreçlerinde tek kaynağı `Counterparty Statement` olarak kullanın.

## 13. Hızlı Senaryo Rehberi

### Senaryo A: Yeni müşteri açılışı ve tahsilat takibi

1. `Alıcı Kartı Oluştur` ile kart aç.
2. `Default Payment Term` ata.
3. İşlem sonrası `AR Aging` ve `Open Items` ile izlemeye al.

Neden:
- Başlangıçtan itibaren vade/tahsilat görünürlüğü sağlanır.

### Senaryo B: Nakit sıkışıklığında ödeme önceliği

1. `AP Aging` çalıştır.
2. `91+` ve `31-60` gecikmiş kritik tedarikçileri belirle.
3. Ödemeleri önceliklendir, kalanları planla.

Neden:
- Operasyon sürekliliği için kritik satıcılar korunur.

### Senaryo C: Cari mutabakat farkı çözümü

1. `Counterparty Statement` ile ilgili cariyi aç.
2. Tartışmalı belgeyi bul.
3. Bağlı kapanış hareketleri ve tarihleriyle birlikte kontrol et.

Neden:
- “Toplam farkı” değil “satır bazında neden” görülebilir.

---

Bu kılavuz son kullanıcı odaklıdır ve günlük kullanım içindir. Yetki/scope, şirket kurulumu ve muhasebe politikası gibi yönetimsel konular için ilgili yönetici ekranları ve şirket içi süreçler esas alınmalıdır.
