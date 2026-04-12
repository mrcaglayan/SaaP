export const SUPPORTED_LANGUAGES = ["tr", "en"];
export const DEFAULT_LANGUAGE = "tr";
export const FALLBACK_LANGUAGE = "en";
export const LANGUAGE_STORAGE_KEY = "ui_language";

export const messages = {
  tr: {
    language: {
      switchLabel: "Dil secimi",
      tr: "TR",
      en: "EN",
    },
    layout: {
      expandSidebar: "Kenar cubugunu genislet",
      collapseSidebar: "Kenar cubugunu daralt",
      financeConsole: "Finans Konsolu",
      proSidebar: "Pro Kenar Cubugu",
      myAccount: "Hesabim",
      loggedInUser: "Giris yapan kullanici",
      logout: "Cikis",
      workspace: "Calisma Alani",
      breadcrumbAria: "Gezinme yolu",
      openSidebar: "Kenar cubugunu ac",
      userFallback: "Kullanici",
      madeWithLoveBy: "sevgiyle yapildi",
      readinessChecking: "Temel kurulum: kontrol",
      readinessError: "Temel kurulum: hata",
      readinessReady: "Tenant bootstrap tamamlandi",
      readinessSetupRequired: "Tenant bootstrap gerekli",
      readinessChecklist: "Temel kurulum kontrol listesi",
      readinessStages: "Hazirlik asamalari",
      readinessAllSet: "Gerekli temel kurulum adimlari tamamlandi.",
      readinessMissingItems: "Eksik kalemler",
      readinessRefresh: "Yenile",
      readinessOpenSetup: "Kurulumu ac",
      bootstrapCompleted: "Tenant bootstrap tamamlandi",
      bootstrapCompletedActivationChecking:
        "Tenant bootstrap tamamlandi • Aktivasyon ozeti kontrol ediliyor",
      bootstrapCompletedActivationError:
        "Tenant bootstrap tamamlandi • Aktivasyon ozeti hatali",
      bootstrapCompletedActivationPendingSingular:
        "Tenant bootstrap tamamlandi • 1 tuzel kisilik aktivasyon bekliyor",
      bootstrapCompletedActivationPendingPlural:
        "Tenant bootstrap tamamlandi • {{count}} tuzel kisilik aktivasyon bekliyor",
      bootstrapCompletedActivationReady:
        "Tenant bootstrap tamamlandi • Tum gorunur tuzel kisilikler hazir",
      activationSectionTitle: "Tuzel kisilik aktivasyonu",
      activationChecking: "Aktivasyon ozeti kontrol ediliyor.",
      activationError: "Aktivasyon ozeti yuklenemedi.",
      activationNoVisibleEntities: "Mevcut kapsamda gorunur tuzel kisilik yok.",
      activationPendingSingular: "1 tuzel kisilik aktivasyon bekliyor",
      activationPendingPlural: "{{count}} tuzel kisilik aktivasyon bekliyor",
      activationPendingDescriptionSingular:
        "1 gorunur tuzel kisilikte bloklayici aktivasyon gorevleri kaldi.",
      activationPendingDescriptionPlural:
        "{{count}} gorunur tuzel kisilikte bloklayici aktivasyon gorevleri kaldi.",
      activationAllSet: "Tum gorunur tuzel kisilikler hazir.",
      activationAllSetDescription:
        "{{count}} gorunur tuzel kisilikte aktivasyon blokaji kalmadi.",
      activationOpenWorkspace: "Aktivasyon alanini ac",
      activationRowReady: "Hazir",
      activationRowPending: "Bekliyor",
      activationMoreRows: "+{{count}} daha",
      currentEntityActivationReady: "Mevcut entity hazir",
      currentEntityActivationPending: "Mevcut entity aktivasyon bekliyor",
    },
    login: {
      title: "Giris",
      email: "E-posta",
      password: "Sifre",
      signIn: "Giris Yap",
      signingIn: "Giris yapiliyor...",
      failed: "Giris basarisiz",
      forgotPassword: "Sifremi Unuttum",
      providerAdminSignIn: "Provider Yonetici Girisi",
    },
    passwordResetRequest: {
      title: "Sifre Sifirlama",
      emailLabel: "E-posta",
      resetLinkReady: "Sifre sifirlama baglantisi hazir:",
      messages: {
        requested: "E-posta kayitliysa sifirlama baglantisi olusturuldu.",
        linkCopied: "Sifirlama baglantisi kopyalandi.",
      },
      errors: {
        requestFailed: "Sifre sifirlama istegi gonderilemedi.",
        copyFailed: "Sifirlama baglantisi kopyalanamadi.",
      },
      actions: {
        submit: "Sifirlama Baglantisi Olustur",
        submitting: "Olusturuluyor...",
        copyLink: "Baglantiyi Kopyala",
        backToLogin: "Giris Sayfasina Don",
      },
    },
    passwordResetComplete: {
      title: "Yeni Sifre Belirle",
      loading: "Sifirlama tokeni kontrol ediliyor...",
      emailLabel: "E-posta",
      statusLabel: "Durum",
      passwordLabel: "Yeni Sifre",
      passwordConfirmLabel: "Yeni Sifre (Tekrar)",
      messages: {
        completed: "Sifre basariyla guncellendi. Giris yapabilirsiniz.",
      },
      errors: {
        missingToken: "Sifirlama tokeni bulunamadi.",
        loadFailed: "Sifirlama bilgisi yuklenemedi.",
        completeFailed: "Sifre guncellenemedi.",
        passwordMismatch: "Sifreler ayni olmali.",
      },
      actions: {
        submit: "Sifreyi Guncelle",
        submitting: "Guncelleniyor...",
        backToLogin: "Giris Sayfasina Don",
      },
    },
    inviteAccept: {
      title: "Davet Baglantisini Tamamla",
      loading: "Davet bilgisi yukleniyor...",
      emailLabel: "E-posta",
      statusLabel: "Durum",
      nameLabel: "Ad Soyad",
      passwordLabel: "Sifre",
      passwordConfirmLabel: "Sifre (Tekrar)",
      messages: {
        accepted: "Davet basariyla tamamlandi. Artik giris yapabilirsiniz.",
      },
      errors: {
        missingToken: "Davet tokeni bulunamadi.",
        loadFailed: "Davet bilgisi yuklenemedi.",
        acceptFailed: "Davet kabul edilemedi.",
        passwordMismatch: "Sifreler ayni olmali.",
      },
      actions: {
        submit: "Hesabi Aktif Et",
        submitting: "Aktif ediliyor...",
        goToLogin: "Giris Sayfasina Don",
      },
    },
    authGuards: {
      loading: "Yukleniyor...",
      accessDeniedTitle: "Erisim reddedildi",
      accessDeniedDescription:
        "Kullanici giris yapmis, ancak bu modulu acmak icin gerekli yetki yok.",
      requiredPermissionsLabel: "Gerekli yetkiler:",
      missingPermissionLine: "Eksik yetki: {{permission}}",
      scopeMismatchDescription:
        "Bu yetkiye sahipsiniz, ancak secili kapsam icin kullanamiyorsunuz.",
      visibilityNarrowedDescription:
        "Gorunurluk atadiginiz kapsamlarla sinirlandirildi; bu nedenle bazi kayitlar ve islemler kullanilamaz kalabilir.",
      providerSessionLoading: "Provider oturumu yukleniyor...",
    },
    providerLogin: {
      title: "Provider Yonetici Girisi",
      subtitle: "Kontrol panelinden tenant yonetimi icin giris yapin.",
      email: "E-posta",
      password: "Sifre",
      emailPlaceholder: "provider-admin@example.com",
      passwordPlaceholder: "********",
      signIn: "Giris Yap",
      signingIn: "Giris yapiliyor...",
      failed: "Provider girisi basarisiz",
      backToUserLogin: "Kullanici Girisine Don",
    },
    providerBootstrap: {
      title: "Provider Tenant Yonetim Paneli",
      subtitle:
        "Kontrol duzleminden tenant aboneliklerini olusturun ve yonetin.",
      signedInAs: "Giris yapan",
      providerAdminFallback: "Provider Yonetici",
      logout: "Cikis",
      statuses: {
        ACTIVE: "Aktif",
        SUSPENDED: "Askida",
      },
      errors: {
        loadTenants: "Tenant listesi yuklenemedi.",
        provisionFailed: "Tenant olusturma islemi basarisiz.",
        updateStatus: "Tenant durumu guncellenemedi.",
        updateTaxEngine: "Tenant vergi motoru ayari guncellenemedi.",
        restoreBootstrapRoles:
          "Bootstrap rollerini geri yukleme islemi basarisiz.",
        loadCountries: "Ulke listesi yuklenemedi.",
        loadCurrencies: "Para birimi listesi yuklenemedi.",
        createCurrency: "Para birimi olusturma islemi basarisiz.",
        updateCurrency: "Para birimi guncellenemedi.",
        createCountry: "Ulke olusturma islemi basarisiz.",
        updateCountry: "Ulke guncellenemedi.",
      },
      messages: {
        created: "Tenant ve ilk yonetici basariyla olusturuldu.",
        statusUpdated: "Tenant #{{id}} durumu {{status}} olarak guncellendi.",
        taxEngineUpdated:
          "Tenant #{{id}} vergi motoru {{status}} olarak guncellendi.",
        bootstrapRolesRestored:
          "Tenant #{{id}} icin SecurityAdmin + SystemAdmin rolleri {{email}} kullanicisina yeniden atandi.",
        currencyCreated: "Para birimi kaydi olusturuldu.",
        currencyUpdated: "Para birimi {{code}} guncellendi.",
        countryCreated: "Ulke kaydi olusturuldu.",
        countryUpdated: "Ulke #{{id}} guncellendi.",
      },
      createTenant: {
        title: "Tenant Olustur",
        fields: {
          enableTaxEngine: "Ulke vergi motorunu etkinlestir",
          enableTaxEngineHelp:
            "Tenant olusurken FEATURE_TAX_ENGINE_V1 kaydi tenant feature tablosuna yazilir.",
        },
        placeholders: {
          tenantCode: "Tenant kodu (orn. ACME)",
          tenantName: "Tenant adi",
          adminName: "Yonetici ad soyad",
          adminEmail: "Yonetici e-posta",
          adminPassword: "Yonetici sifre (en az 8 karakter)",
        },
        actions: {
          provisioning: "Olusturuluyor...",
          create: "Tenant olustur",
        },
        result: {
          title: "Olusturma Sonucu",
          tenant: "Tenant: #{{id}} ({{code}})",
          admin: "Yonetici: #{{id}} ({{email}})",
          roleId: "Rol ID: {{id}}",
          taxEngine: "Vergi motoru: {{status}}",
          enabled: "Etkin",
          disabled: "Devre disi",
        },
      },
      directory: {
        title: "Tenant Dizini",
        loading: "Yukleniyor...",
        refresh: "Yenile",
        searchPlaceholder: "Tenant kodu veya adina gore ara",
        search: "Ara",
        columns: {
          code: "Kod",
          name: "Ad",
          status: "Durum",
          taxEngine: "Vergi motoru",
          users: "Kullanicilar",
          actions: "Islemler",
        },
        actions: {
          activate: "Aktif Et",
          suspend: "Askida Al",
          restoreBootstrap: "Bootstrap rollerini geri yukle",
          restoringBootstrap: "Geri yukleniyor...",
          restoreBootstrapPrompt:
            "{{code}} tenant'i icin SecurityAdmin + SystemAdmin rollerinin yeniden atanacagi kullanici e-postasini girin.",
        },
        taxEngine: {
          label: "Ulke vergi motoru",
          enabled: "Etkin",
          disabled: "Devre disi",
          updating: "Kaydediliyor...",
        },
        empty: "Tenant kaydi bulunamadi.",
      },
      currencies: {
        title: "Para Birimi Master Yonetimi",
        subtitle: "Ulke varsayilan para birimleri bu listeden secilir.",
        loading: "Yukleniyor...",
        refresh: "Yenile",
        searchPlaceholder: "Kod veya ada gore ara",
        immutableCodeNote:
          "Kod (ISO 4217) olusturulduktan sonra bu ekranda degistirilmez.",
        create: {
          title: "Yeni Para Birimi Ekle",
          placeholders: {
            code: "Kod (orn. USD)",
            name: "Para birimi adi",
            minorUnits: "Kurus basamagi (0-9)",
          },
          actions: {
            creating: "Olusturuluyor...",
            create: "Para birimi olustur",
          },
        },
        columns: {
          code: "Kod",
          name: "Ad",
          minorUnits: "Kurus basamagi",
          actions: "Islemler",
        },
        actions: {
          edit: "Duzenle",
          save: "Kaydet",
          cancel: "Iptal",
        },
        empty: "Para birimi kaydi bulunamadi.",
      },
      countries: {
        title: "Ulke Master Yonetimi",
        subtitle:
          "Tenant UI bu listeyi sadece secim icin kullanir; ulke kodlari provider panelinden yonetilir.",
        loading: "Yukleniyor...",
        refresh: "Yenile",
        searchPlaceholder: "ISO kodu, ad veya para birimine gore ara",
        search: "Ara",
        immutableCodesNote:
          "ISO2/ISO3 kodlari olusturulduktan sonra bu ekranda degistirilmez.",
        create: {
          title: "Yeni Ulke Ekle",
          placeholders: {
            iso2: "ISO2 (orn. TR)",
            iso3: "ISO3 (orn. TUR)",
            name: "Ulke adi",
            defaultCurrencyCode: "Varsayilan para birimi secin",
          },
          actions: {
            creating: "Olusturuluyor...",
            create: "Ulke olustur",
          },
        },
        columns: {
          iso2: "ISO2",
          iso3: "ISO3",
          name: "Ad",
          defaultCurrencyCode: "Varsayilan PB",
          actions: "Islemler",
        },
        actions: {
          edit: "Duzenle",
          save: "Kaydet",
          cancel: "Iptal",
        },
        empty: "Ulke kaydi bulunamadi.",
      },
    },
    dashboard: {
      title: "Panel",
      subtitle: "Bu alan korumali /app bolgesi icinde.",
      cards: {
        periodCloseBlockers: "Kapanis ve Hazirlik Engelleri",
        periodCloseBlockersHint:
          "Basarisiz kapanis kontrolleri ile acik tenant/modul hazirlik engelleri.",
      },
    },
    notFound: {
      title: "Sayfa bulunamadi",
      goToApp: "Uygulamaya don",
    },
    breadcrumbs: {
      byPath: {
        "/login": "Giris",
        "/provider/bootstrap": "Provider Baslatma",
      },
    },
    sidebar: {
      titles: {
        "donem-islemleri": "Donem Islemleri",
        kasa: "Kasa",
        "yevmiye-kayitlari": "Yevmiye Kayitlari",
        "kasa-hazirlik-ve-oturum": "Kasa Hazirlik ve Oturum",
        "gunluk-nakit-islemleri": "Gunluk Nakit Islemleri",
        "kontrol-ve-mahsup": "Kontrol ve Mahsup",
        "banka-islemleri": "Banka Islemleri",
        "odeme-islemleri": "Odeme Islemleri",
        "bordro-islemleri": "Bordro Islemleri",
        satinalma: "Satinalma",
        satis: "Satis",
        "cari-islemler": "Cari Islemler",
        "cari-kartlar": "Cari Kartlar",
        "cari-belge-ve-mutabakat": "Cari Belge ve Mutabakat",
        "cari-rapor-ve-denetim": "Cari Rapor ve Denetim",
        "sozlesme-ve-gelir": "Sozlesme ve Gelir",
        stoklar: "Stoklar",
        demirbaslar: "Demirbaslar",
        "donem-sonu-islemler": "Donem Sonu Islemler",
        "aylik-donem-sonu-islemler": "Aysonu İşlemler",
        "yillik-donem-sonu-islemleri": "Yılsonu İşlemler",
        raporlar: "Raporlar",
        "benim-ayarlarim": "Benim Ayarlarim",
        "platform-kurulumu": "Platform Kurulumu",
        "kullanici-ve-erisim-yonetimi": "Kullanici ve Erisim Yonetimi",
        ayarlar: "Ayarlar",
      },
      byPath: {
        "/app": "Dashboard",
        "/app/donem-islemleri": "Donem Islemleri",
        "/app/acilis-fisi": "Acilis Fisi Olustur",
        "/app/journal-entries": "Journal Entry",
        "/app/tediye-islemleri": "Odemeler",
        "/app/tahsilat-islemleri": "Tahsilat",
        "/app/kasa-tanimlari": "Kasa Tanimlari",
        "/app/kasa-oturumlari": "Kasa Oturumlari",
        "/app/kasa-islemleri": "Kasa Islemleri",
        "/app/kasa-transit-transferleri": "Kasa Transit Transferleri",
        "/app/kasa-kur-degisimleri": "Kasa Kur Degisimleri",
        "/app/kasa-kur-raporlari": "Kasa Kur Raporlari",
        "/app/kasa-kur-ops-dashboard": "Kasa Kur Ops Dashboard",
        "/app/kasa-istisnalari": "Kasa Istisnalari",
        "/app/mahsup-islemleri": "Mahsup",
        "/app/banka-islemleri": "Banka Islemleri",
        "/app/banka-tanimla": "Banka Tanimla",
        "/app/banka-ekstre-ice-aktar": "Banka Ekstre Ice Aktar",
        "/app/banka-ekstre-kuyrugu": "Banka Ekstre Kuyrugu",
        "/app/banka-mutabakat": "Banka Mutabakat",
        "/app/banka-onaylar": "Banka Onaylari",
        "/app/ayarlar/operasyon-dashboard": "Operasyon Dashboard",
        "/app/ayarlar/exception-workbench": "Exception Workbench",
        "/app/ayarlar/veri-saklama-snapshot": "Veri Saklama ve Snapshot",
        "/app/odeme-batchleri": "Odeme Batchleri",
        "/app/payroll-runs": "Bordro Runlari",
        "/app/payroll-runs/import": "Bordro Import",
        "/app/payroll-mappings": "Bordro Mappingleri",
        "/app/payroll-ownership": "Bordro Ownership",
        "/app/payroll-liabilities": "Bordro Liabilities",
        "/app/payroll-beneficiaries": "Bordro Beneficiaries",
        "/app/payroll-close-controls": "Bordro Kapanis Kontrolleri",
        "/app/cari-islemler": "Cari Islemler",
        "/app/alici-kart-olustur": "Alicilar Karti Olustur",
        "/app/alici-kart-listesi": "Musteri Kartlari",
        "/app/musteri-kartlari/olustur": "Musteri Karti Olustur",
        "/app/musteri-kartlari": "Musteri Kartlari",
        "/app/satici-kart-olustur": "Saticilar Karti Olustur",
        "/app/satici-kart-listesi": "Tedarikci Kartlari",
        "/app/tedarikci-kartlari/olustur": "Tedarikci Karti Olustur",
        "/app/tedarikci-kartlari": "Tedarikci Kartlari",
        "/app/cari-belgeler": "Cari Belgeler",
        "/app/cari-belgeler?direction=AP": "Alis Faturalari",
        "/app/cari-belgeler?direction=AR": "Satis Faturalari",
        "/app/alis-faturalari": "Alis Faturalari",
        "/app/satis-faturalari": "Satis Faturalari",
        "/app/cari-raporlari": "Cari Raporlari",
        "/app/cari-raporlari?direction=AP": "Tedarikci Raporlari",
        "/app/cari-raporlari?direction=AP&report=balances":
          "Tedarikci Bakiyeleri",
        "/app/cari-raporlari?direction=AR": "Musteri Raporlari",
        "/app/cari-raporlari?direction=AR&report=balances":
          "Musteri Bakiyeleri",
        "/app/tedarikci-raporlari": "Tedarikci Raporlari",
        "/app/musteri-raporlari": "Musteri Raporlari",
        "/app/cari-settlements": "Cari Mahsuplastirma / Tahsilat-Odeme",
        "/app/cari-settlements?direction=AP": "Tedarikci Odemeler",
        "/app/cari-settlements?direction=AR": "Musteri Tahsilatlar",
        "/app/tedarikci-odemeler": "Tedarikci Odemeler",
        "/app/musteri-tahsilatlar": "Musteri Tahsilatlar",
        "/app/cari-audit": "Cari Denetim Izleri",
        "/app/ayarlar/cari-denetim": "Cari Denetim Izleri",
        "/app/contracts": "Sozlesmeler",
        "/app/sozlesmeler": "Sozlesmeler",
        "/app/contracts-and-revenue": "Sozlesmeler",
        "/app/gelecek-yillar-gelirleri": "Donemsellik ve Tahakkuklar",
        "/app/donemsellik-ve-tahakkuklar": "Donemsellik ve Tahakkuklar",
        "/app/periodization-and-accruals": "Donemsellik ve Tahakkuklar",
        "/app/stoklar": "Stoklar",
        "/app/stok-karti-olustur": "Stok Karti Olustur",
        "/app/stok-yansitma-islemleri": "Stok Yansitma Islemleri",
        "/app/stok-transferleri": "Stok Transferleri",
        "/app/stok-maliyet-voucherleri": "Stok Maliyet Voucherleri",
        "/app/stok-maliyet-voucherleri/yeni": "Yeni Stok Maliyet Voucheri",
        "/app/stok-karti-listesi": "Stok Karti Listesi",
        "/app/demirbaslar": "Demirbaslar",
        "/app/demirbas-karti-listesi": "Demirbas Karti Listesi",
        "/app/demirbas-karti-olustur": "Demirbas Karti Olustur",
        "/app/demirbas-alim-islemleri": "Demirbas Alim Islemleri",
        "/app/demirbas-satis-islemleri": "Demirbas Satis Islemleri",
        "/app/demirbas-ops-dashboard": "Demirbas Ops Dashboard",
        "/app/demirbas-amortisman-islemleri": "Amortisman Islemleri",
        "/app/donem-sonu-islemler": "Donem Sonu Islemler",
        "/app/donem-sonu-islemler/aylik": "Aysonu İşlemler",
        "/app/donem-sonu-islemler/aylik/degerleme-islemleri":
          "Değerleme İşlemleri",
        "/app/donem-sonu-islemler/aylik/amortisman-islemleri":
          "Amortisman Islemleri",
        "/app/donem-sonu-islemler/aylik/beyanname-islemleri":
          "Beyanname Islemleri",
        "/app/donem-sonu-islemler/aylik/intercompany-mutabakat":
          "Intercompany Mutabakat",
        "/app/donem-sonu-islemler/yillik": "Yılsonu İşlemler",
        "/app/donem-sonu-islemler/yillik/envanter-islemleri":
          "Envanter Islemleri",
        "/app/donem-sonu-islemler/yillik/kapanis-islemleri":
          "Kapanis Islemleri",
        "/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri":
          "Yerel Kapanis Paketleri",
        "/app/donem-sonu-islemler/yillik/yansitma-islemleri":
          "Yansitma Islemleri",
        "/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari":
          "Konsolidasyon Raporlari",
        "/app/raporlar": "Raporlar",
        "/app/defter-i-kebir": "Defter-i Kebir",
        "/app/muavin": "Muavin",
        "/app/cari-kontrol-mutabakati": "Cari Kontrol Mutabakati",
        "/app/bilanco": "Bilanco",
        "/app/gelir-tablosu": "Gelir Tablosu",
        "/app/stok-raporu": "Stok Raporu",
        "/app/demirbas-raporu": "Demirbas Raporu",
        "/app/mizan-raporu": "Mizan Raporu",
        "/app/ayarlar": "Ayarlar",
        "/app/ayarlar/security-admin": "Kullanıcı Yönetimi",
        "/app/ayarlar/security-admin?view=overview": "Genel Bakis",
        "/app/ayarlar/kullanicilar": "Kullanicilar",
        "/app/ayarlar/security-admin/users": "Kullanicilar ve Atamalar",
        "/app/ayarlar/security-admin/users?tab=users": "Kullanicilar",
        "/app/ayarlar/security-admin/users?tab=people": "Kullanicilar",
        "/app/ayarlar/security-admin/users?tab=assignments":
          "Atamalar",
        "/app/ayarlar/security-admin/users?tab=scopes": "Kapsam erisimi",
        "/app/ayarlar/security-admin/users?tab=delegations":
          "Delegasyonlar",
        "/app/ayarlar/security-admin/users?tab=coverage":
          "Gecici kapsama",
        "/app/ayarlar/rbac/delegations": "Delegasyonlar",
        "/app/ayarlar/rbac/temporary-coverage": "Gecici kapsama",
        "/app/ayarlar/security-admin/users?tab=authority":
          "Kullanicilar",
        "/app/ayarlar/roller-ve-yetkiler": "Roller ve Yetkiler",
        "/app/ayarlar/security-admin/catalog": "Erisim Katalogu",
        "/app/ayarlar/security-admin/catalog?tab=access-model":
          "Erisim Katalogu",
        "/app/ayarlar/security-admin/catalog?tab=roles":
          "Roller ve Yetkiler",
        "/app/ayarlar/security-admin/catalog?tab=field-visibility":
          "Alan Gorunurlugu",
        "/app/ayarlar/security-admin/catalog?tab=group-ap-post":
          "Grup AP Posting",
        "/app/ayarlar/security-admin/workflows": "Workflow Governance",
        "/app/ayarlar/security-admin/workflows?tab=definitions":
          "Workflow Governance",
        "/app/ayarlar/security-admin/workflows?tab=assignments":
          "Workflow Atamalari",
        "/app/ayarlar/security-admin/workflows?tab=coverage":
          "Coverage",
        "/app/ayarlar/security-admin/workflows?tab=records":
          "Workflow Kayitlari",
        "/app/ayarlar/security-admin/workflows?tab=setup":
          "Workflow Kurulumu",
        "/app/ayarlar/security-admin/diagnostics": "Tanilama ve Denetim",
        "/app/ayarlar/security-admin/diagnostics?tab=access":
          "Erisim Aciklanabilirligi",
        "/app/ayarlar/security-admin/diagnostics?tab=compliance":
          "Uyum Raporlari",
        "/app/ayarlar/security-admin/diagnostics?tab=audit":
          "RBAC Denetim Loglari",
        "/app/ayarlar/security-admin/diagnostics?tab=raw-audit":
          "Ham Denetim Loglari",
        "/app/ayarlar/security-admin/diagnostics?tab=sensitive-data":
          "Hassas Veri Denetimi",
        "/app/ayarlar/delegasyonlarim": "Delegasyonlarim",
        "/app/ayarlar/sube-operatorleri": "Yerel Kullanici Yonetimi",
        "/app/ayarlar/sirket-ayarlari": "Sirket Ayarlari",
        "/app/ayarlar/organizasyon-yonetimi": "Organizasyon Yonetimi",
        "/app/ayarlar/entity-aktivasyon-alani": "Entity Aktivasyon Alani",
        "/app/ayarlar/hesap-plani-olustur": "Hesap Plani Olustur",
        "/app/ayarlar/hesap-plani-ayarlari": "Hesap Plani Ayarlari",
        "/app/ayarlar/hesap-yeniden-siniflandirma":
          "Hesap Yeniden Siniflandirma",
        "/app/ayarlar/kur-yonetimi": "Kur Yonetimi",
        "/app/ayarlar/vergi-kurulumu": "Vergi Kurulumu",
        "/app/ayarlar/konsolidasyon-kurulumu": "Konsolidasyon Kurulumu",
        "/app/ayarlar/stok-ayarlari": "Stok Ayarlari",
        "/app/ayarlar/demirbas-ayarlari": "Demirbas Ayarlari",
        "/app/ayarlar/demirbas-zimmetlileri": "Demirbas Zimmetlileri",
      },
    },
    cariSplit: {
      sections: {
        purchases: "Satinalma",
        sales: "Satis",
      },
      pages: {
        vendorBills: "Alis Faturalari",
        salesInvoices: "Satis Faturalari",
        vendors: "Tedarikci Kartlari",
        customers: "Musteri Kartlari",
        apPayments: "Tedarikci Odemeler",
        arReceipts: "Musteri Tahsilatlar",
        apBalances: "Tedarikci Bakiyeleri",
        arBalances: "Musteri Bakiyeleri",
      },
      actions: {
        newVendorBill: "Yeni Alis Faturasi",
        newSalesInvoice: "Yeni Satis Faturasi",
      },
      breadcrumbs: {
        purchases: "Satinalma",
        sales: "Satis",
        vendorBills: "Alis Faturalari",
        salesInvoices: "Satis Faturalari",
        vendors: "Tedarikci Kartlari",
        customers: "Musteri Kartlari",
        apPayments: "Tedarikci Odemeler",
        arReceipts: "Musteri Tahsilatlar",
        apBalances: "Tedarikci Bakiyeleri",
        arBalances: "Musteri Bakiyeleri",
      },
    },
    fixedAssets: {
      actions: {
        createAsset: "Yeni Demirbas Olustur",
        activate: "Aktiflestir",
        suspend: "Askiya Al",
        reactivate: "Yeniden Aktiflestir",
        physicalMove: "Fiziksel Hareket",
        ownershipTransfer: "Sahiplik Transferi",
        writeoff: "Hurda Islem",
        sale: "Satis",
        reverse: "Ters Kayit",
        overrideAccounts: "Hesap Eslemelerini Gecersiz Kil",
      },
      permissions: {
        missingRead: "Eksik yetki: fixed_assets.read",
        missingUpsert: "Eksik yetki: fixed_assets.upsert",
        missingPost: "Eksik yetki: fixed_assets.post",
        missingDispose: "Eksik yetki: fixed_assets.dispose",
        missingTransfer: "Eksik yetki: fixed_assets.transfer",
        missingDepreciationRun: "Eksik yetki: fixed_assets.depreciation.run",
        missingReportRead: "Eksik yetki: fixed_assets.report.read",
        readOnlyNotice: "Salt okunur erisim - duzenleme yetkiniz yok.",
      },
      acquisitions: {
        title: "Demirbas Alim Islemleri",
        description: "Alim ve kapitalizasyon islemleri filtrelenmis gorunumu.",
        noResults: "Alim veya kapitalizasyon islemi bulunamadi.",
        preferredFlowTitle: "Tercih Edilen Akis",
        preferredFlowNote:
          "Tercih edilen alim akisi artik CARI formundaki FIXED_ASSET satiridir. Tedarikci faturasina tek bir FIXED_ASSET satiri ve miktar girin; kayit sirasinda varlik birimleri otomatik olusturulur. Belirli bir taslak varlik zaten hazirsa yalnizca link-existing yolunu kullanin.",
        expandGuidanceNote:
          "Birimlerin kayit oncesi farkli sahip/lokasyon veya seri metadata ihtiyaci varsa 'Tekil varlik satirlarina genislet' kullanin. Muhasebe veya kategori farkliysa ayri CARI satirlarina bolun.",
        capitalizeFromAp: "CARI Belgesinden Kapitalize Et",
        capitalizeDescription:
          "Kayitli bir CARI AP belgesindeki uygun kalem satirindan yeni demirbas olusturun.",
        fallbackTitle: "Legacy Fallback",
        fallbackDescription:
          "Bu bolum, FIXED_ASSET satir tipi olmadan zaten kaydedilmis AP belgeleri icin fallback olarak kalir. Yeni alimlarda tercih edilen akis CARI formundaki FIXED_ASSET satiridir.",
        documentId: "Belge ID",
        searchLines: "Satirlari Ara",
        searching: "Araniyor...",
        eligibleLines: "Uygun AP Satirlari",
        noEligibleLines: "Bu belge icin uygun AP satiri bulunamadi.",
        selectLine: "Sec",
        selectedLine: "Secili Satir",
        lineDescription: "Satir Aciklamasi",
        lineAmount: "Tutar",
        lineCurrency: "Para Birimi",
        lineAccount: "Hesap",
        clearSelection: "Secimi Temizle",
        assetDetails: "Demirbas Bilgileri",
        fieldUnitCount: "Adet",
        fieldCategory: "Kategori",
        fieldOwnerOu: "Sahip Isletme Birimi",
        fieldLocationOu: "Lokasyon Isletme Birimi",
        fieldCapitalizationDate: "Aktiflesme Tarihi",
        fieldInServiceDate: "Hizmete Giris Tarihi",
        submit: "Demirbas Olustur",
        submitting: "Olusturuluyor...",
        submitSuccess: "Demirbas CARI belgesinden olusturuldu.",
        submitFailed: "Demirbas olusturulamadi.",
        documentIdRequired: "Belge ID zorunludur.",
        lineRequired: "Bir AP satiri secmelisiniz.",
        linkedFromCari: "CARI'ye Bagli",
        cariCapitalization: "CARI Kapitalizasyonu",
      },
      detail: {
        preferredSaleFlowTitle: "Tercih Edilen Satis Akisi",
        preferredSaleFlowDescription:
          "Yeni satislarda tercih edilen akis, bu varligi hedefleyen FIXED_ASSET satirli bir CARI AR belge taslagi olusturmaktir.",
        preferredSaleFlowTargetLabel: "Hedef Varlik",
        preferredSaleFlowStepOne:
          "Kisayol, CARI Belgeler sayfasinda AR yonlu bir belge taslagini bu varlik icin hazirlar.",
        preferredSaleFlowStepTwo:
          "Satir Tipi olarak Duran Varlik secin, bu varligi hedef olarak baglayin, satis hesabi ve tutari girin.",
        preferredSaleFlowStepThree:
          "Belgeyi kaydedip kayda alin; satis ve elden cikarma akisi tek posting icinde tamamlanir.",
        openCariSaleFlow: "Satis Faturasi Taslagi Ac",
        missingCariSalePermissions:
          "Bu ekrandan tercih edilen satis akisina gitmek icin cari.doc.read ve cari.doc.create yetkileri gerekir.",
        legacySaleFallbackTitle: "Legacy Fallback",
        legacySaleFallbackDescription:
          "Eski cok adimli satis staging akisi kaldirilmaz; yalnizca onceki staged/legacy vakalar icin fallback olarak kalir. Yeni satislarda tercih edilen akis CARI AR FIXED_ASSET belgesidir.",
        createLegacySaleFallbackDraft: "Legacy Satis Taslagi Olustur",
        creatingLegacySaleFallbackDraft:
          "Legacy satis taslagi olusturuluyor...",
        openLegacySaleFallbackDraft: "Legacy taslagi ac",
        legacySaleFallbackCreateSuccess:
          "Legacy satis fallback taslagi olusturuldu. Kalan duzenleme ve posting adimlarini taslak belge uzerinden tamamlayin.",
        legacySaleFallbackCounterpartyId: "Cari ID",
        legacySaleFallbackDocumentDate: "Belge Tarihi",
        legacySaleFallbackAmount: "Satis Tutari",
        legacySaleFallbackHelper:
          "Bu fallback yalnizca eski staged akislar icindir. Kisa yol kullanmadan once cari ve satis tutarini girin.",
        missingLegacySaleFallbackPermissions:
          "Legacy fallback taslagi olusturmak icin fixed_assets.dispose ve cari.doc.create yetkileri gerekir.",
        legacySaleFallbackMissingAsset:
          "Legacy satis fallback taslagi icin gecerli bir varlik bulunamadi.",
        legacySaleFallbackCounterpartyRequired: "Cari ID zorunludur.",
        legacySaleFallbackDocumentDateRequired: "Belge tarihi zorunludur.",
        legacySaleFallbackAmountRequired:
          "Satis tutari 0'dan buyuk bir sayi olmalidir.",
        legacySaleFallbackCreateFailed:
          "Legacy satis fallback taslagi olusturulamadi.",
      },
      disposals: {
        title: "Demirbas Satis/Elden Cikarma",
        description: "Satis, elden cikarma ve hurda islemleri.",
        noResults: "Satis veya elden cikarma islemi bulunamadi.",
      },
      reports: {
        title: "Demirbas Raporlari",
        selectReport: "Rapor Secin",
        runReport: "Raporu Calistir",
        exportCsv: "CSV Indir",
        exporting: "Indiriliyor...",
        noResults: "Sonuc bulunamadi.",
        loading: "Yukleniyor...",
        filterLegalEntity: "Tuzel Kisilik",
        filterDateFrom: "Baslangic Tarihi",
        filterDateTo: "Bitis Tarihi",
        filterCategory: "Kategori",
        filterOwnerOu: "Sahip Isletme Birimi",
        filterLocationOu: "Lokasyon Isletme Birimi",
        filterCustodian: "Zimmetli",
        filterStatus: "Durum",
        filterPeriodKey: "Donem Anahtari",
        register: "Demirbas Kaydi",
        depreciationSchedule: "Amortisman Takvimi",
        additions: "Eklemeler (Alim / Kapitalizasyon)",
        disposals: "Elden Cikarma (Hurda / Satis)",
        transfers: "Sahiplik Transferleri",
        byOwnerOu: "Sahip Isletme Birimine Gore",
        byLocationOu: "Lokasyon Isletme Birimine Gore",
        byCustodian: "Zimmetliye Gore",
        depreciationByOwnerOu: "Donem Amortismani - Sahip IB",
        rollforward: "Rollforward (Hareket Tablosu)",
        totalsLabel: "Toplamlar",
        totalCount: "Toplam Adet",
        totalCostBase: "Toplam Maliyet (Baz)",
        acquisitionCount: "Alim Sayisi",
        capitalizationCount: "Kapitalizasyon Sayisi",
        writeoffCount: "Hurda Sayisi",
        saleCount: "Satis Sayisi",
        belowThreshold: "Esik Altinda",
        lowValueFullExpense: "Dusuk Deger Tam Gider",
        openingNbv: "Acilis NBV",
        closingNbv: "Kapanis NBV",
        totalDeprBase: "Toplam Amortisman (Baz)",
      },
      createForm: {
        title: "Demirbas Olustur",
        backToRegister: "Listeye don",
        sectionIdentity: "Kimlik ve Tanimlama",
        sectionOrganization: "Organizasyon Atamalari",
        sectionCost: "Maliyet ve Para Birimi",
        sectionDepreciation: "Amortisman Ayarlari",
        sectionLegacy: "Eski Sistem Devri (Legacy Onboarding)",
        sectionAccounts: "Hesap Esleme Gecersiz Kilma",
        fieldName: "Demirbas Adi",
        fieldDescription: "Aciklama",
        fieldAssetTag: "Etiket",
        fieldSerialNo: "Seri No",
        fieldCategory: "Kategori",
        fieldLegalEntity: "Tuzel Kisilik",
        fieldOwnerOu: "Sahip Isletme Birimi",
        fieldLocationOu: "Lokasyon Isletme Birimi",
        fieldDepartmentCode: "Departman Kodu",
        fieldCostCenterCode: "Masraf Merkezi Kodu",
        fieldCustodian: "Zimmetli",
        fieldAcquisitionDate: "Alim Tarihi",
        fieldCurrencyCode: "Para Birimi",
        fieldOriginalCostTxn: "Orijinal Maliyet (Islem)",
        fieldOriginalCostBase: "Orijinal Maliyet (Baz)",
        fieldDepreciationProfile: "Amortisman Profili",
        fieldUsefulLifeMonths: "Faydali Omur (ay)",
        fieldSalvageRuleType: "Hurda Kural Tipi",
        fieldSalvagePercent: "Hurda Yuzdesi (%)",
        fieldSalvageAmountBase: "Hurda Tutar (Baz)",
        fieldRemainingUsefulLifeMonths: "Kalan Faydali Omur (ay)",
        fieldLegacyAccumDeprTxn: "Eski Birikimli Amortisman (Islem)",
        fieldLegacyAccumDeprBase: "Eski Birikimli Amortisman (Baz)",
        fieldLegacyNbvTxn: "Eski NBV (Islem)",
        fieldLegacyNbvBase: "Eski NBV (Baz)",
        fieldInServiceDate: "Hizmete Giris Tarihi",
        fieldPostingDate: "Posting Tarihi",
        fieldCapitalizationDate: "Aktiflesme Tarihi",
        fieldAssetAccount: "Varlik Hesabi",
        fieldAccumDeprAccount: "Birikimli Amortisman Hesabi",
        fieldDeprExpenseAccount: "Amortisman Gider Hesabi",
        fieldDisposalGainAccount: "Elden Cikarma Kar Hesabi",
        fieldDisposalLossAccount: "Elden Cikarma Zarar Hesabi",
        saveDraft: "Taslak Kaydet",
        saving: "Kaydediliyor...",
        activateAsset: "Aktiflestir",
        activating: "Aktiflestiriliyor...",
        lowValueNotice:
          "Bu demirbas, kategori kapitalizasyon esiginin altinda. Aktiflestirme sirasinda tamamen giderlestirilebilir.",
        legacyNotice:
          "Eski sistem alanlarini yalnizca mevcut varliklar icin doldurun, yeni alimlar icin bos birakin.",
        accountOverrideNotice:
          "Hesap gecersiz kilma alanlari yalnizca fixed_assets.account_override yetkisi olanlara gosterilir.",
        validationRequired: "Bu alan zorunludur",
        validationPositiveNumber: "Sifirdan buyuk veya esit bir sayi giriniz",
        createSuccess: "Demirbas taslagi olusturuldu.",
        activateSuccess: "Demirbas aktiflestirme basarili.",
        createFailed: "Demirbas olusturulamadi.",
        activateFailed: "Demirbas aktiflestirilemedi.",
        categoryDefaults: "Kategori varsayimlari forma uygulandi.",
      },
    },
    opsDashboard: {
      title: "Operasyon Dashboard (H05)",
      filters: {
        legalEntityId: "Legal entity ID",
        bankAccountId: "Banka hesap ID",
        dateFrom: "Baslangic tarihi",
        dateTo: "Bitis tarihi",
        daysFallback: "Gun fallback",
        jobsModuleCode: "Jobs modul kodu",
        jobsQueueName: "Jobs kuyruk adi",
      },
      placeholders: {
        optional: "opsiyonel",
        days: "30",
      },
      actions: {
        refresh: "Yenile",
        refreshing: "Yenileniyor...",
        exportUsageCsv: "Kullanim CSV Disa Aktar",
        exportingUsage: "Kullanim disa aktariliyor...",
        exportAuditCsv: "Denetim CSV Disa Aktar",
        exportingAudit: "Denetim disa aktariliyor...",
        openCashTransitQueue: "Nakit transit kuyrugunu ac",
      },
      sections: {
        bankReconciliation: "Banka Mutabakat Ozeti",
        bankPayments: "Banka Odeme Batch Sagligi",
        cashTransit: "Nakit Transit Kuyrugu",
        payrollImports: "Bordro Import Sagligi",
        payrollClose: "Bordro Kapanis Durumu",
        jobs: "Jobs Sagligi",
      },
      cashTransit: {
        awaitingReceipt: "Teslim alimi bekleyen",
        pendingDispatch: "Gonderim bekleyen",
        receivedInWindow: "Aralikta teslim alinan",
        oldestWaitingHours: "En eski bekleme (saat)",
        waitingAging: "Bekleme yaslandirmasi",
        oldestWaitingTransfers: "En eski bekleyen transferler",
        noIncomingWaiting: "Teslim alimi bekleyen transit transfer bulunmuyor.",
        route: "Rota",
        amount: "Tutar",
        waitingSince: "Bekleme baslangici",
      },
      messages: {
        loadFailed: "Ops dashboard verisi yuklenemedi",
        usageExportReady: "Kullanim CSV indirildi: {{fileName}}",
        usageExportFailed: "Kullanim CSV disa aktarma basarisiz",
        auditExportReady: "Denetim CSV indirildi: {{fileName}}",
        auditExportFailed: "Denetim CSV disa aktarma basarisiz",
        exportUnavailable:
          "Disa aktarma sadece tarayici oturumlarinda kullanilabilir.",
      },
    },
    exceptionsWorkbench: {
      title: "Birlesik Exception Workbench (H06)",
      total: "Toplam: {{total}}",
      filters: {
        module: "Modul",
        status: "Durum",
        severity: "Seviye",
        legalEntityId: "Legal entity ID",
        search: "Ara",
        days: "Gun",
        autoRefresh: "Liste icin kaynaklari otomatik yenile",
        all: "Tum",
      },
      placeholders: {
        optional: "opsiyonel",
        search: "baslik/kaynak/not",
        days: "180",
        resolutionNote: "Resolve/ignore/reopen aksiyonlarinda kullanilir",
      },
      actions: {
        loading: "Yukleniyor...",
        applyFilters: "Filtreleri Uygula",
        manualRefresh: "Manuel Yenile",
        refreshing: "Yenileniyor...",
        details: "Detay",
        claim: "Sahiplen",
        resolve: "Coz",
        ignore: "Yok Say",
        reopen: "Tekrar Ac",
      },
      bulk: {
        selectVisible: "Gorunenleri sec",
        selectedCount: "Secili: {{count}}",
        clearSelection: "Secimi Temizle",
        claimSelected: "Seciliyi Sahiplen",
        resolveSelected: "Seciliyi Coz",
        ignoreSelected: "Seciliyi Yok Say",
        reopenSelected: "Seciliyi Tekrar Ac",
        selectRow: "Exception satirini sec",
        select: "Sec",
      },
      summary: {
        byStatus: "Duruma Gore",
        byModule: "Module Gore",
        bySeverity: "Seviyeye Gore",
      },
      sections: {
        exceptions: "Exception Kayitlari",
        resolutionNote: "Cozum Notu",
        selectedException: "Secili Exception",
        auditTrail: "Denetim Izleri",
      },
      labels: {
        lastSeen: "son gorulme:",
        source: "kaynak:",
      },
      messages: {
        loadFailed: "Exception workbench yuklenemedi",
        detailLoadFailed: "Exception detayi yuklenemedi",
        workbenchRefreshed: "Workbench yenilendi.",
        refreshFailed: "Yenileme basarisiz",
        actionApplied: "Aksiyon uygulandi: {{action}}.",
        actionFailed: "Aksiyon basarisiz: {{action}}",
        bulkActionApplied:
          "Toplu aksiyon uygulandi: {{action}} ({{count}} kayit).",
        bulkActionPartial:
          "Toplu aksiyon {{action}} kismi basariyla tamamlandi ({{succeeded}}/{{total}} basarili, {{failed}} hata).",
        bulkActionFailed: "Toplu aksiyon basarisiz: {{action}}.",
        missingReadPermission: "Eksik yetki:",
        empty: "Mevcut filtreler icin exception bulunamadi.",
        selectRow: "Bir exception satiri secip Detay'a tiklayin.",
        noAudit: "Denetim kaydi yok.",
      },
    },
    retentionAdmin: {
      title: "Veri Saklama ve Export Snapshotlari",
      subtitle:
        "PR-H07: policy bazli retention runlari ve immutable kapanmis donem snapshot hashleri.",
      sections: {
        policies: "Retention Policies",
        runs: "Retention Runlari",
        snapshots: "Donem Export Snapshotlari",
      },
      placeholders: {
        policyCode: "Policy Kodu",
        policyName: "Policy Adi",
        retentionDays: "Saklama Gunu",
        legalEntityOptional: "Legal Entity ID (opsiyonel)",
        leId: "LE ID",
        dataset: "Dataset",
        status: "Durum",
        search: "Ara",
        policyId: "Policy ID",
        payrollCloseId: "Payroll Close ID",
        idempotencyKeyOptional: "Idempotency key (opsiyonel)",
      },
      actions: {
        creating: "Olusturuluyor...",
        loading: "Yukleniyor...",
        createPolicy: "Policy Olustur",
        refreshPolicies: "Policyleri Yenile",
        updating: "Guncelleniyor...",
        toggleStatus: "Durumu Degistir",
        runSync: "Sync Calistir",
        queueAsync: "Async Kuyruga Al",
        refreshRuns: "Runlari Yenile",
        view: "Goruntule",
        createSnapshot: "Snapshot Olustur",
        refreshSnapshots: "Snapshotlari Yenile",
      },
      totals: {
        policies: "Toplam policy: {{total}}",
        runs: "Toplam run: {{total}}",
        snapshots: "Toplam snapshot: {{total}}",
      },
      table: {
        code: "Kod",
        datasetAction: "Dataset/Aksiyon",
        le: "LE",
        days: "Gun",
        status: "Durum",
        lastRun: "Son Run",
        actions: "Aksiyonlar",
        run: "Run",
        policy: "Policy",
        counts: "Sayaclar",
        startedFinished: "Basladi/Bitti",
        detail: "Detay",
        snapshot: "Snapshot",
        lePeriod: "LE / Donem",
        closeId: "Close ID",
        hash: "Hash",
      },
      labels: {
        tenant: "TENANT",
        scanned: "taranan:",
        affected: "etkilenen:",
        maskedPurgedArchived: "mask/purge/archive:",
        le: "LE:",
      },
      messages: {
        missingPermissions: "Eksik yetkiler:",
        andOr: "ve/veya",
        policiesLoadFailed: "Retention policy listesi yuklenemedi",
        runsLoadFailed: "Retention run listesi yuklenemedi",
        snapshotsLoadFailed: "Export snapshot listesi yuklenemedi",
        policyCreated: "Retention policy olusturuldu.",
        policyCreateFailed: "Retention policy olusturulamadi",
        policyStatusUpdated:
          "Policy {{code}} durumu {{status}} olarak guncellendi.",
        policyStatusUpdateFailed: "Policy durumu guncellenemedi",
        runQueued: "Retention run job olarak kuyruga alindi (#{{id}}).",
        runCompleted: "Retention run tamamlandi (#{{id}}).",
        runFailed: "Retention run basarisiz",
        runDetailLoadFailed: "Retention run detayi yuklenemedi",
        snapshotExists: "Snapshot zaten var (#{{id}}).",
        snapshotCreated: "Snapshot olusturuldu (#{{id}}).",
        snapshotCreateFailed: "Export snapshot olusturulamadi",
        snapshotDetailLoadFailed: "Snapshot detayi yuklenemedi",
      },
    },
    intercompanyReconciliation: {
      title: "Intercompany Mutabakat",
      subtitle:
        "Istirak / bagli ortak ciftleri arasindaki intercompany hareketlerini karsilastirir ve uyumsuzluklari gosterir.",
      loadingLookups: "Lookup secenekleri yukleniyor...",
      missingPermission: "Eksik yetki: intercompany.reconcile.run",
      fiscalPeriodRequired: "fiscalPeriodId zorunludur.",
      toleranceInvalid: "tolerance sifir veya pozitif bir sayi olmalidir.",
      runFailed: "Mutabakat calistirilamadi.",
      runSuccess: "Mutabakat tamamlandi. Cift sayisi: {{count}}.",
      calendarLabel: "Mali takvim",
      calendarPlaceholder: "Mali takvim secin",
      calendarIdPlaceholder: "Mali takvim ID",
      periodLabel: "Mali donem",
      periodPlaceholder: "Mali donem secin",
      periodIdPlaceholder: "Mali donem ID",
      fromEntityLabel: "Kaynak istirak / bagli ortak",
      fromEntityPlaceholder: "Tum kaynak istirakler / bagli ortaklar",
      fromEntityIdPlaceholder: "Kaynak istirak / bagli ortak ID (opsiyonel)",
      toEntityLabel: "Karsi taraf istirak / bagli ortak",
      toEntityPlaceholder: "Tum karsi taraf istirakler / bagli ortaklar",
      toEntityIdPlaceholder: "Karsi taraf istirak / bagli ortak ID (opsiyonel)",
      toleranceLabel: "Esik degeri",
      includeMatched: "Eslesen ciftleri dahil et",
      includeAccountBreakdown: "Hesap kirilimini dahil et",
      runButton: "Mutabakati Calistir",
      runningButton: "Mutabakat calisiyor...",
      summary:
        "Ciftler: {{pairCount}} | Eslesen: {{matchedPairCount}} | Uyumsuz: {{mismatchedPairCount}} | Tek tarafli: {{unilateralPairCount}} | Toplam mutlak fark: {{total}}",
      table: {
        pair: "Cift",
        status: "Durum",
        abNet: "A->B Net",
        baNet: "B->A Net",
        difference: "Fark",
        empty: "Mutabakat satiri yok. Filtreleri secip mutabakati calistirin.",
      },
    },
    consolidationReports: {
      title: "Konsolidasyon Raporlari",
      subtitle:
        "Konsolide bilanco/gelir tablosunu goruntuler ve taslak eliminasyon/duzeltmeleri post eder.",
      missingPermissionRun: "Eksik yetki: consolidation.run.read",
      missingPermissionBs:
        "Eksik yetki: consolidation.report.balance_sheet.read",
      missingPermissionIs:
        "Eksik yetki: consolidation.report.income_statement.read",
      missingPermissionAdj: "Eksik yetki: consolidation.adjustment.post",
      missingPermissionElim: "Eksik yetki: consolidation.elimination.post",
      runRequired: "consolidation runId zorunludur.",
      loadRunsFailed: "Konsolidasyon calismalari yuklenemedi.",
      loadBsFailed: "Bilanco yuklenemedi.",
      loadIsFailed: "Gelir tablosu yuklenemedi.",
      loadWorklistFailed: "Konsolidasyon is listesi yuklenemedi.",
      postAdjFailed: "Duzeltme post edilemedi.",
      postElimFailed: "Eliminasyon satiri post edilemedi.",
      loadBsSuccess: "Konsolide bilanco yuklendi.",
      loadIsSuccess: "Konsolide gelir tablosu yuklendi.",
      loadWorklistSuccess: "Konsolidasyon taslak/post is listesi yuklendi.",
      postAdjSuccess: "Duzeltme #{{id}} post edildi.",
      postElimSuccess: "Eliminasyon kaydi #{{id}} post edildi.",
      runLabel: "Konsolidasyon calismasi",
      runPlaceholder: "Konsolidasyon calismasi secin",
      runIdPlaceholder: "Konsolidasyon run ID",
      rateTypeLabel: "Kur tipi",
      includeDraft: "Taslak duzeltme/eliminasyonlari dahil et",
      includeZero: "Sifir bakiyeli satirlari dahil et",
      loadBsButton: "Bilanco Yukle",
      loadBsLoading: "Bilanco yukleniyor...",
      loadIsButton: "Gelir Tablosu Yukle",
      loadIsLoading: "Gelir tablosu yukleniyor...",
      loadWorklistButton: "Taslak Is Listesini Yukle",
      loadWorklistLoading: "Yukleniyor...",
      refreshRunsButton: "Calismalari Yenile",
      refreshRunsLoading: "Yenileniyor...",
      selectedRunSummary:
        "Run #{{id}} | Grup: {{groupCode}} - {{groupName}} | Donem: {{fiscalYear}}-P{{periodNo}} ({{periodName}}) | Durum: {{status}}",
      workflow: {
        title: "Workflow onay kapisi durumu",
        openSetup: "Workflow yonetimini ac",
        loading: "Workflow kapi durumu yukleniyor...",
        loadFailed: "Workflow kapi durumu yuklenemedi.",
        summary:
          "Durum: {{status}} | Mevcut adim: {{step}} | Tanim: {{definitionCode}}",
        none: "Bu run icin henuz workflow instance yok. Kapi aktifse finalize sirasinda olusturulur/kontrol edilir.",
        missingPermission:
          "Eksik yetki: org.tree.read (workflow kapi detayini gormek icin gerekli).",
      },
      bsTotals:
        "Bilanco Varliklar: {{assets}} | Yukumlulukler: {{liabilities}} | Ozkaynak: {{equity}} | Donem Kari: {{earnings}} | Delta: {{delta}}",
      isTotals:
        "Gelir Tablosu Gelir: {{revenue}} | Gider: {{expense}} | Net kar: {{net}}",
      tables: {
        bsTitle: "Bilanco satirlari",
        isTitle: "Gelir tablosu satirlari",
        account: "Hesap",
        type: "Tip",
        normalized: "Normalize",
        bsEmpty:
          "Bilanco satiri yok. Bir run secip Bilanco Yukle butonuna basin.",
        isEmpty:
          "Gelir tablosu satiri yok. Bir run secip Gelir Tablosu Yukle butonuna basin.",
        adjustmentsTitle: "Duzeltme Is Listesi",
        eliminationsTitle: "Eliminasyon Is Listesi",
        id: "ID",
        status: "Durum",
        description: "Aciklama",
        debit: "Borc",
        credit: "Alacak",
        lines: "Satir",
        action: "Islem",
        post: "Post et",
        posting: "Post ediliyor...",
        none: "-",
        adjustmentsEmpty:
          "Duzeltme satiri yok. Taslak is listesini yukleyin veya yeni duzeltme olusturun.",
        eliminationsEmpty:
          "Eliminasyon satiri yok. Taslak is listesini yukleyin veya yeni eliminasyon olusturun.",
      },
    },
    userAssignments: {
      title: "Kullanici Atama Yonetimi",
      subtitle: "Kullanicilara kapsamli (scope) rol atamasi yapin.",
      loadFailed: "Atama verileri yuklenemedi",
      missingPermission: "Eksik yetki: security.role_assignment.upsert",
      scopeInvalid: "scopeId pozitif bir tam sayi olmalidir.",
      userCreateSuccess: "Davet olusturuldu.",
      userCreateFailed: "Davet olusturulamadi.",
      saveFailed: "Rol atamasi kaydedilemedi",
      saveSuccess: "Rol atamasi kaydedildi.",
      deleteConfirm: "Bu rol atamasini silmek istiyor musunuz?",
      deleteFailed: "Atama silinemedi",
      deleteSuccess: "Atama silindi.",
      createUser: {
        title: "Kullanici Davet Et (Baglanti Kopyala)",
        name: "Ad Soyad",
        email: "E-posta",
        submit: "Davet Olustur",
        submitting: "Davet olusturuluyor...",
        inviteLinkReady: "Davet baglantisi hazir:",
        copyInviteLink: "Davet Baglantisini Kopyala",
        inviteCopied: "Davet baglantisi kopyalandi.",
        inviteCopyFailed: "Davet baglantisi kopyalanamadi.",
      },
      placeholders: {
        user: "Kullanici secin",
        role: "Rol secin",
        scope: "Scope secin",
        scopeId: "Scope ID",
      },
      actions: {
        assign: "Ata",
        assigning: "Kaydediliyor...",
        delete: "Sil",
      },
      list: {
        title: "Mevcut Rol Atamalari",
        loading: "Atamalar yukleniyor...",
        empty: "Atama bulunamadi.",
        user: "Kullanici",
        role: "Rol",
        scope: "Scope",
        effect: "Etki",
        action: "Islem",
      },
    },
    branchOperators: {
      title: "Yerel Kullanici Yonetimi",
      subtitle:
        "Yonettiginiz entity ve isletim birimlerinde allow-list kapsamindaki yerel rolleri davet edin, atayin ve kaldirin.",
      loadFailed: "Yerel kullanici yonetimi verileri yuklenemedi.",
      saveFailed: "Yerel rol atamasi kaydedilemedi.",
      deleteFailed: "Yerel rol atamasi silinemedi.",
      deleteConfirm: "Bu yerel rol atamasini silmek istiyor musunuz?",
      missingPermission: "Yerel kullanici yonetimi icin gereken yetki yok.",
      noOperatingUnits:
        "Yonetecek erisilebilir entity veya isletim birimi bulunamadi.",
      noRoles:
        "Bu tenant icin allow-list kapsaminda atanabilir yerel rol bulunamadi.",
      form: {
        title: "Yerel Kullanici Davet Et",
        subtitle:
          "Yeni kullaniciyi davet edin veya mevcut tenant kullanicisina secili scope icin yerel rol atayin.",
        name: "Ad Soyad",
        email: "E-posta",
        selectRole: "Rol secin",
        roleRequired: "Rol secimi zorunludur.",
        selectScopeType: "Scope turu secin",
        scopeTypeLegalEntity: "Entity scope",
        scopeTypeOperatingUnit: "Isletim birimi scope",
        selectLegalEntity: "Entity secin",
        legalEntityRequired: "Entity secimi zorunludur.",
        selectOperatingUnit: "Isletim birimi secin",
        submit: "Yerel Rol Ata",
        submitting: "Kaydediliyor...",
        operatingUnitRequired: "Isletim birimi secimi zorunludur.",
        roleCount: "Yonetilebilir rol: {{count}}",
        entityCount: "Erisilebilir entity: {{count}}",
      },
      messages: {
        inviteCreated: "Davet ve yerel rol atamasi hazir.",
        assignmentCreated: "Yerel rol atamasi kaydedildi.",
        assignmentExists: "Kullanici secili scope icin zaten atanmis.",
        assignmentRemoved: "Yerel rol atamasi silindi.",
        inviteLinkReady: "Davet baglantisi hazir:",
        copyInviteLink: "Davet Baglantisini Kopyala",
        inviteCopied: "Davet baglantisi kopyalandi.",
        inviteCopyFailed: "Davet baglantisi kopyalanamadi.",
      },
      actions: {
        delete: "Sil",
      },
      list: {
        title: "Mevcut Yerel Rol Atamalari",
        loading: "Yerel rol atamalari yukleniyor...",
        empty: "Yerel rol atamasi bulunamadi.",
        user: "Kullanici",
        role: "Rol",
        scope: "Scope",
        status: "Durum",
        action: "Islem",
        userStatus: "Kullanici:",
        scopeStatus: "Scope:",
      },
    },
    scopeAssignments: {
      title: "Scope Atama Yonetimi",
      subtitle:
        "Kullanici veri scope'larini degistirin ve mevcut rol atamalarinin scope bilgisini guncelleyin.",
      loadLookupsFailed: "Scope lookup verileri yuklenemedi",
      loadUserScopeFailed: "Kullanici scope verileri yuklenemedi",
      missingDataScopePermission: "Eksik yetki: security.data_scope.upsert",
      missingAssignmentPermission:
        "Eksik yetki: security.role_assignment.upsert",
      scopeRequired: "Scope ID zorunludur.",
      replaceScopesFailed: "Kullanici veri scope'lari degistirilemedi",
      replaceScopesSuccess: "Kullanici veri scope'lari guncellendi.",
      replaceAssignmentFailed: "Atama scope'u guncellenemedi",
      replaceAssignmentSuccess: "Rol atamasi scope'u guncellendi.",
      userLabel: "Kullanici",
      userPlaceholder: "Kullanici secin",
      dataScopesTitle: "Veri Scope'lari",
      assignmentTitle: "Mevcut Rol Atamasi Scope Guncelle",
      selectScope: "Scope secin",
      selectAssignment: "Atama secin",
      addScope: "Scope Ekle",
      removeScope: "Kaldir",
      replaceScopesButton: "Kullanici Veri Scope'larini Guncelle",
      replaceAssignmentButton: "Guncelle",
      saving: "Kaydediliyor...",
      loading: "Kullanicilar ve scope lookup verileri yukleniyor...",
      emptyScopes: "Bu kullanici icin scope tanimli degil.",
      columns: {
        scopeType: "Scope Tipi",
        scopeId: "Scope ID",
        effect: "Etki",
        action: "Islem",
      },
    },
    rolesPermissions: {
      title: "Rol ve Yetki Yonetimi",
      subtitle:
        "Rolleri olusturun ve rol bazinda acik yetki atamalarini yonetin.",
      errors: {
        loadFailed: "Roller ve yetkiler yuklenemedi",
        missingUpsertPermission: "Eksik yetki: security.role.upsert",
        missingAssignPermission:
          "Eksik yetki: security.role_permissions.assign",
        saveRoleFailed: "Rol kaydedilemedi",
        replacePermissionsFailed: "Rol yetkileri degistirilemedi",
      },
      messages: {
        roleSaved: "Rol olusturuldu veya guncellendi.",
        permissionsReplaced: "Rol yetkileri degistirildi.",
      },
      placeholders: {
        roleCode: "Rol kodu (orn. FinanceReadOnly)",
        roleName: "Rol adi",
      },
      actions: {
        saving: "Kaydediliyor...",
        saveRole: "Rolu Kaydet",
        replacePermissions: "Yetkileri Degistir",
      },
      sections: {
        roles: "Roller",
        loadingRoles: "Roller yukleniyor...",
        permissions: "Yetkiler",
        permissionsFor: "{{code}} icin Yetkiler",
        loadingPermissions: "Yetkiler yukleniyor...",
      },
    },
    rbacAuditLogs: {
      title: "RBAC Denetim Loglari",
      subtitle: "Rol/yetki/scope yonetimi denetim izlerini inceleyin.",
      errors: {
        loadFailed: "RBAC denetim loglari yuklenemedi",
      },
      filters: {
        allScopeTypes: "Tum scope tipleri",
        scopeId: "Scope ID",
        action: "Aksiyon (orn. role.create)",
        resourceType: "Kaynak tipi",
        apply: "Filtreleri Uygula",
      },
      recordsTitle: "Denetim Log Kayitlari",
      loading: "Loglar yukleniyor...",
      empty: "Log bulunamadi.",
      columns: {
        time: "Zaman",
        action: "Aksiyon",
        resource: "Kaynak",
        actor: "Yapan",
        target: "Hedef",
        scope: "Scope",
        payload: "Icerik",
      },
      pagination: {
        summary: "Sayfa {{page}} / {{totalPages}} | Toplam kayit: {{total}}",
        previous: "Onceki",
        next: "Sonraki",
      },
    },
    rawAuditLogs: {
      title: "Ham Denetim Loglari",
      subtitle:
        "Sistemin audit_logs tablosunu okunabilir sekilde filtreleyin; aksiyon, kaynak, requestId ve payload detaylarini inceleyin.",
      errors: {
        loadFailed: "Ham denetim loglari yuklenemedi.",
      },
      filters: {
        allScopeTypes: "Tum scope tipleri",
        scopeId: "Scope ID",
        userId: "Kullanici ID",
        action: "Aksiyon ara",
        resourceType: "Kaynak tipi ara",
        resourceId: "Kaynak ID ara",
        requestId: "Request ID ara",
        apply: "Filtreleri Uygula",
        reset: "Sifirla",
      },
      recordsTitle: "Ham Log Kayitlari",
      loading: "Ham loglar yukleniyor...",
      empty: "Ham denetim logu bulunamadi.",
      columns: {
        time: "Zaman",
        action: "Aksiyon",
        resource: "Kaynak",
        user: "Kullanici",
        scope: "Scope",
        requestId: "Request ID",
        details: "Detay",
        ipAddress: "IP",
        userAgent: "User agent",
      },
      actions: {
        viewDetails: "Detayi gor",
      },
      pagination: {
        summary: "Sayfa {{page}} / {{totalPages}} | Toplam kayit: {{total}}",
        previous: "Onceki",
        next: "Sonraki",
      },
    },
    accessDebugger: {
      loading: "Erisim zinciri yukleniyor...",
      empty: "Katmanli erisim zincirini gormek icin bir kontrol calistirin.",
      labels: {
        yes: "Evet",
        no: "Hayir",
      },
      actions: {
        whyCantIDoThis: "Bunu neden yapamiyorum?",
        explainAccess: "Erisimi Acikla",
        run: "Erisim Kontrolunu Calistir",
        running: "Kontrol ediliyor...",
        reset: "Sifirla",
        close: "Kapat",
      },
      modal: {
        title: "Bunu neden yapamiyorum?",
        subtitle:
          "Bu islem icin yetki, kapsam, gorunurluk ve diger yonetisim katmanlarini inceleyin.",
      },
      page: {
        title: "Erisim Tanilari",
        subtitle:
          "Bir kullanicinin secili workflow ailesi ve hedef kapsamdaki etkili yetkisini aciklayin; is-rolu etiketlerini, workflow paketlerini, kapsam uyumunu ve alttaki teknik erisim zincirini ayni yerde gorun.",
        noteTitle: "Yonetici gorunumu",
        noteBody:
          "Bu panel diger kullanicilarin etkili yetki tanisini ve teknik erisim zincirini aciklar. Diger kullanicilar icin kontrol backend tarafinda yalnizca SecurityAdmin kapsaminda acilir.",
      },
      form: {
        userPlaceholder: "Kullanici secin",
        permissionPlaceholder: "Yetki kodu (orn. payments.batch.approve)",
        noScope: "Kapsam secme",
        scopePlaceholder: "Kapsam secin",
        scopeId: "Scope ID",
        advanced: "Gelismis baglam",
        moduleCode: "Modul kodu",
        objectType: "Nesne tipi",
        fieldName: "Alan adi",
        workflowRequestId: "Workflow request ID",
        actionCode: "Aksiyon kodu",
        recordType: "Kayit tipi",
        recordId: "Kayit ID",
      },
      errors: {
        loadLookupsFailed: "Kullanici veya scope lookup verileri yuklenemedi.",
        targetUserRequired: "Hedef kullanici secimi zorunludur.",
        runFailed: "Erisim zinciri kontrolu calistirilamadi.",
      },
      summary: {
        allowed: "Erisim acik",
        denied: "Erisim engelli",
        selfCheck: "Bu sonuc kullanicinin kendi erisim zinciridir.",
        adminCheck:
          "Bu sonuc yonetici tarafindan calistirilan kullanici erisim zinciridir.",
        permission: "Yetki",
        scope: "Istenen kapsam",
        targetUser: "Hedef kullanici",
        visibilityNarrowed: "Gorunurluk daraltildi",
        maskedFields: "Maskelenen alanlar",
        recommendations: "Onerilen sonraki adimlar",
        layers: "Katman sonuclari",
        technicalDetails: "Teknik detaylar",
        notProvided: "Belirtilmedi",
      },
      layers: {
        capability: "Capability",
        scopeEntitlement: "Scope entitlement",
        visibilityPolicy: "Visibility policy",
        sod: "SoD",
        workflow: "Workflow",
        businessState: "Business state",
        fieldVisibility: "Field visibility",
      },
      recommendations: {
        missingPermission:
          "{{permission}} yetkisini gerekli ise SecurityAdmin uzerinden atayin.",
        scopeDenied:
          "Yetkiyi {{scopeType}} #{{scopeId}} kapsaminda verin veya kullanicinin mevcut kapsamiyla uyumlu bir kapsam secin.",
        visibilityDenied:
          "Kullanici veri scope gorunurlugunu gozden gecirin. Aksiyon kapsaminda yetki var, ancak satir gorunurlugu daha dar.",
        fieldVisibility:
          "Alan tam gorunur olmaliysa {{permission}} kapsamli override yetkisini degerlendirin.",
        sod: "Ayni kayitta ayristirma kuralini karsilamak icin farkli bir onaylayan veya operator kullanin.",
        workflow:
          "Workflow onay adimini tamamlayin veya dogru onaylayani belirleyin.",
        businessState:
          "Kayittaki is durumu engelini cozup islemi tekrar deneyin.",
        visibilityNarrowed:
          "Bazi kayitlar atanan data scope'lari nedeniyle gorunmez kalabilir.",
      },
    },
    cashControlMode: {
      title: "Kasa kontrol modu: {{mode}}",
      modes: {
        OFF: "OFF",
        WARN: "WARN",
        ENFORCE: "ENFORCE",
      },
      descriptions: {
        OFF: "Direkt GL kayitlarinda cash-control denetimi kapali.",
        WARN: "Direkt GL kayitlari engellenmez; cash-control uyari kaydi olusturulur.",
        ENFORCE:
          "Cash-controlled hesaplara direkt GL kaydi engellenir; CASH kaynagi veya override gerekir.",
      },
      unavailable: "Kasa kontrol modu bilgisi su an alinamiyor.",
      requestId: "Talep ID: {{requestId}}",
    },
    cashRegisters: {
      title: "Kasa Tanimlari",
      subtitle:
        "Kasa register kayitlarini listeleyin, yeni register olusturun, guncelleyin ve aktif/pasif yonetin.",
      readOnlyNotice:
        "Yalnizca goruntuleme modundasiniz. Duzenleme islemleri icin cash.register.upsert yetkisi gerekir.",
      loading: "Kasa kayitlari yukleniyor...",
      empty: "Kasa kaydi bulunamadi.",
      sections: {
        create: "Yeni Kasa Register",
        edit: "Kasa Register Duzenle",
        list: "Kasa Register Listesi",
      },
      actions: {
        create: "Kaydet",
        update: "Guncelle",
        edit: "Duzenle",
        cancelEdit: "Duzenlemeyi Iptal Et",
        quickSetup: "Hizli Kurulum",
        closeQuickSetup: "Hizli Kurulumu Kapat",
        runQuickSetup: "Secilenleri Olustur",
        quickSetupSaving: "Hizli kurulum calisiyor...",
        selectPreferredCurrency: "Tercih edileni sec",
        selectAll: "Tumunu sec",
        clearSelection: "Secimi temizle",
        activate: "Aktif Et",
        deactivate: "Pasif Et",
        refresh: "Yenile",
        loading: "Yukleniyor...",
        saving: "Kaydediliyor...",
      },
      form: {
        code: "Kod",
        name: "Ad",
        legalEntityId: "Legal entity ID",
        ownershipScope: "Sahiplik",
        ownershipCentralHelp:
          "Merkez register'lari OU boyutu olmadan merkezi baglamda calisir.",
        ownershipOperatingUnitHelp:
          "Operating Unit register'lari secilen subeye baglidir ve sube baglaminda isler.",
        operatingUnitIdOptional: "Operating unit ID (opsiyonel)",
        operatingUnitIdRequired: "Operating unit ID (zorunlu)",
        operatingUnitHiddenForCentral:
          "Merkez sahipliginde operating unit secimi kullanilmaz.",
        accountId: "Hesap ID",
        currencyCode: "Para birimi (USD)",
        allowNegative: "Negatif bakiyeye izin ver",
        varianceGainAccountIdOptional: "Fazla fark hesabi ID (opsiyonel)",
        varianceLossAccountIdOptional: "Eksik fark hesabi ID (opsiyonel)",
        maxTxnAmountOptional: "Maksimum islem tutari (opsiyonel)",
        requiresApprovalOverAmountOptional:
          "Onay gerektiren esik tutari (opsiyonel)",
      },
      placeholders: {
        legalEntity: "Legal entity secin",
        sessionMode: "Oturum modu secin",
        operatingUnit: "Operating unit secin",
        account: "Hesap secin",
        currencyCode: "Para birimi secin",
        varianceGainAccount: "Fazla fark hesabi secin (opsiyonel)",
        varianceLossAccount: "Eksik fark hesabi secin (opsiyonel)",
      },
      accountPicker: {
        searchPlaceholder: "Hesap kod/adi ara",
        selectLegalEntityFirst: "Once legal entity secin",
        noOptions: "Hesap bulunamadi.",
        searchHelp:
          "Kod veya ad yazarak arayin. Kod bulunamazsa buradan alt hesap olusturabilirsiniz.",
        codeNotFoundHint:
          "{{code}} kodu bulunamadi. Bu kod ile parent altinda yeni hesap olusturabilirsiniz.",
        parentPlaceholder: "Parent hesap secin",
        parentNoOptions: "Parent hesap bulunamadi.",
        childCodePlaceholder: "Yeni alt hesap kodu",
        childNamePlaceholder: "Yeni alt hesap adi",
        useTypedCode: "Aranan kodu kullan",
        useNextCode: "Sonraki alt kodu kullan",
        createChild: "Alt hesap olustur ve sec",
        creatingChild: "Alt hesap olusturuluyor...",
        missingUpsertPermissionHint:
          "Alt hesap olusturmak icin gl.account.upsert yetkisi gerekir.",
      },
      quickSetup: {
        title: "Hizli Kasa Kurulumu",
        description:
          "Mevcut legal entity / sahiplik secimini kullanarak secilen para birimleri icin alt kasa hesaplari ve register kayitlari olusturun.",
        selectedCount: "{{count}} para birimi secildi",
        scopeLabel: "Kapsam",
        scopeMissing: "Once kapsam secimini tamamlayin.",
        defaultsLabel: "Kullanilacak Varsayilanlar",
        defaultsHelp:
          "Register type: {{registerType}} | session mode: {{sessionMode}} | status: {{status}}",
        operatingUnitLabel: "Operating unit / sube",
        operatingUnitHelp:
          "Operating Unit sahipliginde quick setup'in hangi sube icin register acacagini buradan secin.",
        noOperatingUnits:
          "Secili legal entity icin operating unit kaydi bulunamadi. Once Organizasyon Yonetimi ekranindan sube/OU kaydi acin.",
        parentAccountLabel: "Parent kasa hesabi",
        parentAccountPlaceholder:
          "Alt hesaplarin acilacagi parent hesabi secin",
        parentAccountHelp:
          "Quick setup, her para birimi icin bu parent altinda postable child hesap acar ve register'i o hesaba baglar.",
        currencyLabel: "Para birimleri",
        blockerLegalEntity: "legal entity secin",
        blockerOperatingUnit: "operating unit secin",
        blockerParentAccount: "parent hesap secin",
        blockerCurrency: "en az bir para birimi secin",
        blockedBy: "Buton pasif: {{reasons}}",
        readyHint:
          "Hazir. Secilen para birimleri icin child hesaplar ve register kayitlari olusturulacak.",
      },
      table: {
        code: "Kod",
        name: "Ad",
        ownership: "Sahiplik",
        registerType: "Register Tipi",
        sessionMode: "Oturum Modu",
        legalEntity: "Legal Entity",
        operatingUnit: "Operating Unit",
        account: "Hesap",
        currency: "Para Birimi",
        allowNegative: "Negatif Izin",
        status: "Durum",
        actions: "Islemler",
      },
      values: {
        yes: "Evet",
        no: "Hayir",
        ownershipCentral: "Merkez",
        ownershipOperatingUnit: "Operating Unit",
        centralHq: "Merkez",
      },
      errors: {
        missingReadPermission:
          "Bu sayfayi kullanmak icin cash.register.read yetkisi gerekir.",
        missingUpsertPermission:
          "Bu islem icin cash.register.upsert yetkisi gerekir.",
        missingAccountUpsertPermission:
          "Alt hesap olusturmak icin gl.account.upsert yetkisi gerekir.",
        loadRegisters: "Kasa kayitlari yuklenemedi.",
        loadOrgLookups:
          "Organizasyon lookup verileri yuklenemedi. Gerekirse ID alanlarini manuel doldurun.",
        loadAccountLookups:
          "Hesap lookup verileri yuklenemedi. Gerekirse hesap ID alanlarini manuel doldurun.",
        missingOrgLookupPermission:
          "org.tree.read yetkisi olmadan legal entity/operating unit/currency lookup listeleri yuklenmez.",
        missingAccountLookupPermission:
          "gl.account.read yetkisi olmadan hesap lookup listeleri yuklenmez.",
        requiredCodeName: "Kod ve ad alanlari zorunludur.",
        requiredSessionMode: "sessionMode zorunludur.",
        requiredEntityAccount: "legalEntityId ve accountId zorunludur.",
        requiredCurrency: "currencyCode zorunludur.",
        operatingUnitRequiredForOwnership:
          "Operating Unit sahipliginde operatingUnitId secilmelidir.",
        invalidAmount: "Tutar alanlarinda gecersiz deger var.",
        parentAccountRequired: "Alt hesap olusturmak icin parent hesap secin.",
        childAccountCodeRequired: "Alt hesap kodu zorunludur.",
        childAccountNameRequired: "Alt hesap adi zorunludur.",
        childAccountCodeParentConflict:
          "Alt hesap kodu parent hesap kodu ile ayni olamaz.",
        childAccountParentCoaMissing:
          "Secilen parent hesap icin coaId bulunamadi.",
        createChildAccount: "Alt hesap olusturulamadi.",
        quickSetupRequiresAccountLookup:
          "Hizli kurulum icin gl.account.read ve gl.account.upsert yetkileri gerekir.",
        quickSetupParentMustBeAsset:
          "Hizli kurulum parent hesabi aktif bir ASSET hesap olmali.",
        quickSetupParentAlreadyRegister:
          "Secilen parent hesap zaten bir kasa register'ina bagli. Bunun altina child acmak mevcut register yapisini bozar.",
        quickSetupCurrencyRequired:
          "Hizli kurulum icin en az bir para birimi secin.",
        quickSetupNoChildCode:
          "Secilen parent altinda yeni child hesap kodu uretilemedi.",
        quickSetupFailed: "Hizli kurulum tamamlanamadi.",
        save: "Kasa kaydi kaydedilemedi.",
        statusUpdate: "Kasa kaydi durumu guncellenemedi.",
      },
      messages: {
        created: "Kasa kaydi olusturuldu.",
        updated: "Kasa kaydi guncellendi.",
        statusUpdated:
          "Kasa kaydi {{code}} durumu {{status}} olarak guncellendi.",
        accountExistsSelected: "{{code}} zaten mevcut. Mevcut hesap secildi.",
        childAccountCreatedAndSelected:
          "{{code}} alt hesabi olusturuldu (parent: {{parentCode}}) ve secildi.",
        quickSetupCompleted:
          "Hizli kurulum tamamlandi. {{createdCount}} register olusturuldu, {{existingCount}} mevcut register atlandi, {{accountCount}} child hesap olusturuldu.",
        quickSetupPartial:
          "Hizli kurulum kismen tamamlandi. {{createdCount}} register olusturuldu, {{existingCount}} mevcut register atlandi, {{accountCount}} child hesap olusturuldu, {{failedCount}} para biriminde hata var.",
      },
    },
    cashSessions: {
      title: "Kasa Oturumlari",
      subtitle:
        "Kasa oturumlarini acin/kapatin, acik oturumlari ve gecmis oturum hareketlerini takip edin.",
      loading: "Kasa oturumlari yukleniyor...",
      emptyOpen: "Acik kasa oturumu bulunamadi.",
      emptyHistory: "Kasa oturum gecmisi bulunamadi.",
      readOnlyOpenNotice:
        "Oturum acma islemi icin cash.session.open yetkisi gerekir.",
      readOnlyCloseNotice:
        "Oturum kapatma islemi icin cash.session.close yetkisi gerekir.",
      approvalNotice:
        "Esik uzeri farki onaylamak icin cash.variance.approve yetkisi gerekir.",
      forcedCloseNotice: "FORCED_CLOSE secildiginde closeNote zorunludur.",
      sections: {
        open: "Oturum Ac",
        close: "Oturum Kapat",
        openSessions: "Acik Oturumlar",
        history: "Oturum Gecmisi",
        lifecycle: "Oturum Yasam Dongusu",
      },
      actions: {
        open: "Oturum Ac",
        close: "Oturumu Kapat",
        refresh: "Yenile",
        loading: "Yukleniyor...",
        saving: "Kaydediliyor...",
        useForClose: "Kapatmak Icin Sec",
        inspectLifecycle: "Yasam Dongusu",
      },
      form: {
        openingAmountOptional: "Acilis tutari (opsiyonel, varsayilan 0)",
        countedClosingAmount: "Sayilan kapanis tutari",
        closeNote: "Kapanis notu (FORCED_CLOSE / esik uzeri farkta zorunlu)",
        approveVariance: "Esik uzeri farki onayla (approveVariance=true)",
      },
      placeholders: {
        register: "Kasa register secin",
        openSession: "Acik oturum secin",
      },
      table: {
        register: "Register",
        status: "Durum",
        openedAt: "Acilis Zamani",
        closedAt: "Kapanis Zamani",
        opening: "Acilis",
        expected: "Beklenen",
        counted: "Sayilan",
        variance: "Fark",
        closedReason: "Kapanis Nedeni",
        approvedBy: "Onaylayan",
        approvedAt: "Onay Zamani",
        actions: "Islemler",
      },
      values: {
        statusOpen: "Acik",
        statusClosed: "Kapali",
      },
      lifecycle: {
        snapshotTitle: "Yasam Dongusu Ozeti",
        selectedSummary:
          "Secili oturum #{{id}} | Register: {{registerCode}} | Durum: {{status}}",
        nextTransitions: "Siradaki izinli gecisler: {{actions}}",
        noTransitions: "Bu durumdan tanimli baska yasam dongusu gecisi yok.",
        noSelection: "Yasam dongusu detaylarini gormek icin bir oturum secin.",
        timelineTitle: "Oturum Yasam Dongusu Zaman Cizelgesi",
        timelineEmpty: "Bu oturum icin yasam dongusu gecmisi bulunamadi.",
        actionLabels: {
          close: "Oturumu Kapat",
        },
      },
      requiredWarning: {
        title: "Session mode REQUIRED ama acik oturum yok",
        description:
          "Asagidaki aktif registerlar icin acik oturum bulunmuyor. Islem olusturma/post akislarinda engel olusabilir.",
      },
      selectedSessionSummary:
        "Secili oturum #{{id}} | Register: {{registerCode}} | Acilis: {{opening}} | Beklenen: {{expected}}",
      errors: {
        missingReadPermission:
          "Bu sayfayi kullanmak icin cash.register.read yetkisi gerekir.",
        missingOpenPermission:
          "Bu islem icin cash.session.open yetkisi gerekir.",
        missingClosePermission:
          "Bu islem icin cash.session.close yetkisi gerekir.",
        missingVarianceApprovePermission:
          "Bu islem icin cash.variance.approve yetkisi gerekir.",
        load: "Kasa oturumlari yuklenemedi.",
        open: "Kasa oturumu acilamadi.",
        close: "Kasa oturumu kapatilamadi.",
        requestId: "Talep ID: {{requestId}}",
        registerRequired: "registerId zorunludur.",
        invalidOpeningAmount: "Acilis tutari gecersiz.",
        sessionRequired: "sessionId zorunludur.",
        countedRequired: "countedClosingAmount zorunludur.",
        closeNoteForced: "FORCED_CLOSE icin closeNote zorunludur.",
        closeNoteApproval:
          "approveVariance=true oldugunda closeNote girmeniz gerekir.",
      },
      errorsMapped: {
        registerNotFound: "Secilen register bulunamadi.",
        sessionAlreadyOpen: "Bu register icin zaten OPEN oturum bulunuyor.",
        sessionModeNone:
          "Bu register icin session_mode=NONE oldugu icin oturum acilamaz.",
        registerInactive: "Secilen register ACTIVE degil.",
        sessionNotFound: "Secilen oturum bulunamadi.",
        onlyOpenClose: "Yalnizca OPEN oturumlar kapatilabilir.",
        unpostedTransactionsExist:
          "DRAFT/SUBMITTED/APPROVED islemler varken oturum kapatilamaz.",
        closeNoteThreshold: "Fark esigi asildiginda closeNote zorunludur.",
        varianceApprovalRequired:
          "Fark esigi asildi; supervisor/finance onayi gereklidir.",
        varianceGainMissing:
          "Fazla fark icin varianceGainAccountId register uzerinde tanimli olmalidir.",
        varianceLossMissing:
          "Eksik fark icin varianceLossAccountId register uzerinde tanimli olmalidir.",
      },
      messages: {
        opened: "Kasa oturumu basariyla acildi.",
        closed: "Kasa oturumu basariyla kapatildi.",
      },
    },
    cashTransactions: {
      presetTitles: {
        all: "Kasa Islemleri",
        payout: "Odeme Islemleri",
        receipt: "Tahsilat Islemleri",
      },
      subtitle:
        "Kasa islemlerini filtreleyin, yeni islem olusturun ve post/iptal/ters kayit akislarini yonetin.",
      presetNotices: {
        payout: "Bu ekranda islem tipi PAYOUT olarak sabitlenmistir.",
        receipt: "Bu ekranda islem tipi RECEIPT olarak sabitlenmistir.",
      },
      loading: "Kasa islemleri yukleniyor...",
      empty: "Kasa islem kaydi bulunamadi.",
      readOnlyNotice:
        "Yalnizca goruntuleme modundasiniz. Islem olusturmak icin cash.txn.create yetkisi gerekir.",
      sections: {
        filters: "Filtreler",
        create: "Yeni Kasa Islemi",
        action: "Secili Islem Aksiyonu",
        lifecycle: "Islem Yasam Dongusu",
        list: "Kasa Islem Listesi",
      },
      placeholders: {
        allRegisters: "Tum registerlar",
        allTypes: "Tum islem tipleri",
        allStatuses: "Tum durumlar",
        register: "Register secin",
        sessionSelectRegisterFirst: "Once register secin",
        sessionOptional: "Oturum (opsiyonel)",
        sessionRequired: "Oturum (zorunlu)",
        sessionNotUsed: "Oturum kullanilmiyor (session_mode=NONE)",
        autoOrNone: "Otomatik / yok",
        searchCounterparty: "Muhatap kodu/adi ara",
        searchAccount: "Hesap kodu/adi ara",
        searchBankAccount: "Banka hesabi / GL kodu ara",
        selectCounterparty: "Muhatap secin",
        counterAccount: "Karsi hesap secin",
        bankCounterAccount: "Banka hesabi secin",
        counterRegister: "Karsi register secin",
      },
      form: {
        registerId: "registerId",
        registerIdManualFallback: "Register listesi yok; register ID girin",
        sessionId: "sessionId",
        cashSessionIdOptional: "cashSessionId (opsiyonel)",
        cashSessionIdRequiredManualFallback:
          "Secili register icin OPEN cashSessionId girin (zorunlu)",
        cashSessionIdSelectRegisterFirst: "Once register secin",
        cashSessionIdNotUsed:
          "Secili register session_mode=NONE; cashSessionId gerekmez",
        cashSessionIdManualFallback:
          "Oturum listesi yoksa cashSessionId girin (opsiyonel)",
        amount: "Tutar",
        currencyCode: "Para birimi (USD)",
        referenceNoOptional: "Referans no (opsiyonel)",
        sourceDocIdOptional: "Kaynak dokuman ID (opsiyonel)",
        sourceDocTypeOptional: "Kaynak dokuman tipi (opsiyonel)",
        counterpartyTypeOptional: "Muhatap tipi (opsiyonel)",
        counterpartyIdOptional: "Muhatap ID (opsiyonel)",
        counterpartyIdManualFallback: "Muhatap ID (manuel)",
        counterAccountIdOptional: "counterAccountId (opsiyonel)",
        bankCounterAccountIdManualFallback: "Banka GL hesap ID (manuel)",
        counterAccountIdManualFallback: "Karsi hesap ID (manuel)",
        counterCashRegisterIdOptional: "counterCashRegisterId (opsiyonel)",
        descriptionOptional: "Aciklama (opsiyonel)",
        transitTransferId: "transitTransferId",
        bookDate: "bookDate",
        txnDatetime: "txnDatetime",
        idempotencyKey: "idempotencyKey",
        fxRateOptional: "fxRate (opsiyonel)",
        useUnappliedCash: "useUnappliedCash",
        noteOptional: "Not (opsiyonel)",
        settlementDate: "settlementDate",
        asOfDateOpenDocs: "asOfDate (acik belgeler)",
        overrideCashControl: "Cash control override ile post et",
        overrideReason: "Override nedeni (zorunlu)",
        cancelReason: "Iptal nedeni (zorunlu)",
        reverseReason: "Ters kayit nedeni (zorunlu)",
      },
      actions: {
        applyFilters: "Filtreyi Uygula",
        clear: "Temizle",
        clearFilters: "Temizle",
        refresh: "Yenile",
        loading: "Yukleniyor...",
        openRegisterSetup: "Kasa Tanimlari'na git",
        openSessionSetup: "Kasa Oturumlari'na git",
        openBankAccountSetup: "Banka Tanimla'ya git",
        fillAll: "Tumunu Doldur",
        create: "Islem Olustur",
        creating: "Olusturuluyor...",
        preparePost: "Post Et",
        prepareCancel: "Iptal Et",
        prepareReverse: "Ters Kayit",
        receiveTransit: "Transit Teslim Al",
        applyCari: "Cari Uygula",
        submitAction: "Aksiyonu Uygula",
        cancelAction: "Vazgec",
        inspectLifecycle: "Yasam Dongusu",
        saving: "Kaydediliyor...",
      },
      selectedTransactionSummary:
        "Secili islem #{{id}} | No: {{txnNo}} | Durum: {{status}}",
      lifecycle: {
        snapshotTitle: "Yasam Dongusu Ozeti",
        nextTransitions: "Siradaki izinli gecisler: {{actions}}",
        noTransitions: "Bu durumdan tanimli baska yasam dongusu gecisi yok.",
        timelineTitle: "Islem Yasam Dongusu Zaman Cizelgesi",
        timelineEmpty: "Bu islem icin yasam dongusu gecmisi bulunamadi.",
        actionLabels: {
          submit: "Gonder",
          approve: "Onayla",
          post: "Post et",
          cancel: "Iptal et",
          reverse: "Ters kayit",
        },
        events: {
          draft: "Taslak olusturuldu.",
          submitted: "Onaya gonderildi.",
          approved: "Onaylandi.",
          posted: "Deftere post edildi.",
          cancelled: "Islem iptal edildi.",
          reversed: "Ters kayit tamamlandi.",
        },
      },
      table: {
        id: "ID",
        txnNo: "Islem No",
        txnType: "Tip",
        status: "Durum",
        register: "Register",
        session: "Oturum",
        bookDate: "Book Date",
        amount: "Tutar",
        currency: "PB",
        counterparty: "Muhatap",
        counterAccount: "Karsi Hesap",
        counterRegister: "Karsi Register",
        links: "Baglantilar",
        postedJournal: "Post Journal",
        overrideReason: "Override Nedeni",
        createdAt: "Olusturma",
        actions: "Islemler",
      },
      values: {
        notApplicable: "Uygulanmaz",
        readOnly: "Salt okunur",
        statusDraft: "Taslak",
        statusSubmitted: "Gonderildi",
        statusApproved: "Onaylandi",
        statusPosted: "Post Edildi",
        statusReversed: "Ters Kayit",
        statusCancelled: "Iptal Edildi",
        loadingCounterparties: "Muhataplar yukleniyor...",
        selectedCounterparty: "Secili muhatap: {{code}} - {{name}} ({{type}})",
        selectedCounterAccount: "Secili hesap: {{code}} - {{name}}",
        selectedBankCounterAccount:
          "Secili banka hesabi: {{code}} - {{name}} (GL: {{glCode}})",
        linked: "Bagli",
        transitStatusInitiated: "Baslatildi",
        transitStatusInTransit: "Yolda",
        transitStatusReceived: "Teslim Alindi",
        transitStatusCanceled: "Iptal Edildi",
        transitStatusReversed: "Ters Kayit",
        transitBadge: "Transit #{{transferId}} ({{status}})",
        transitPairBadge: "CIKIS #{{outTxnId}} / GIRIS #{{inTxnId}}",
        settlementBadge: "Mahsuplastirma #{{settlementBatchId}}",
        unappliedBadge: "Uygulanmamis #{{unappliedCashId}}",
      },
      apply: {
        openDocsTitle: "Acik belge secici (ham ID girmeden)",
        openDocsDescription:
          "Her acik kalem icin uygulanacak tutari girin. Tum tutarlar bos birakilirsa islemin tamami unapplied cash olarak kaydedilir.",
        selectedTotal: "Secili toplam: {{total}}",
        loadingOpenDocuments: "Acik belgeler yukleniyor...",
        noOpenDocuments: "Bu islem icin acik belge bulunamadi.",
        table: {
          document: "Belge",
          openItem: "OpenItem",
          dueDate: "Vade",
          openAmount: "Acik",
          applyAmount: "Uygula",
        },
      },
      warnings: {
        registerLookupUnavailable:
          "Register lookup verileri yuklenemedi; register alanlarini manuel doldurmaniz gerekebilir.",
        sessionLookupUnavailable:
          "Oturum lookup verileri yuklenemedi; cashSessionId alanini manuel doldurmaniz gerekebilir.",
        accountLookupUnavailable:
          "Hesap lookup verileri yuklenemedi; counterAccountId alanini manuel doldurmaniz gerekebilir.",
        bankAccountLookupUnavailable:
          "Banka hesabi lookup verileri yuklenemedi; banka GL hesabini manuel girmeniz gerekebilir.",
        counterpartyPickerUnavailableManual:
          "Muhatap secici kullanilamiyor; muhatap ID'yi manuel girin.",
        noRegisterList:
          "Register listesi bulunamadi. Kasa Tanimlari ekranindan en az bir register olusturup aktif hale getirin.",
        bankCounterAccountPermissionMissing:
          "Banka hesabi secici kullanilamiyor: bank.accounts.read yetkisi eksik. Banka GL hesabini manuel girin.",
        bankCounterAccountNeedsRegister:
          "Banka hesabi secmek icin once register secin.",
        bankCounterAccountNeedsLegalEntity:
          "Banka hesabi secici baslatilamadi; secili register legal entity baglami tasimiyor.",
        noActiveBankAccountsForRegister:
          "Secili legal entity icin aktif banka hesabi bulunamadi. Once banka hesabi tanimlayin.",
        sessionPickerNeedsRegister:
          "Oturum secmek icin once register secin. Register yoksa Kasa Tanimlari ekranindan olusturun.",
        noOpenSessionForRegister:
          "Secili register icin acik (OPEN) oturum bulunamadi. Kasa Oturumlari ekranindan yeni oturum acin.",
        counterpartyPickerPermissionMissing:
          "Muhatap secici kullanilamiyor: cari.card.read yetkisi eksik. Muhatap ID'yi manuel girin.",
        counterpartyPickerNeedsRegister:
          "Muhatap secici icin once register secilmelidir. Register yoksa Kasa Tanimlari ekranindan olusturun.",
        counterpartyPickerNeedsLegalEntity:
          "Secili register icin legal entity bilgisi bulunamadi. Kasa Tanimlari ekranindan register kaydini kontrol edin.",
        registerInactive: "Secili register ACTIVE degil.",
        currencyMismatch:
          "Islem para birimi register para birimi ile uyusmuyor (register: {{registerCurrency}}).",
        maxAmountExceeded:
          "Islem tutari register maxTxnAmount limitini asiyor (max: {{max}}).",
        crossOuTransitCounterRequired:
          "Farkli operating-unit baglamlari arasindaki transferler cash transit ve self-balancing cari hesap kurulumunu kullanir.",
        crossOuTransitSelfBalancingInfo:
          "Farkli operating-unit baglamlari arasindaki transit, self-balancing cari hesap kurulumunu kullanir. Bu formda transit-clearing hesap secimi gerekmez.",
        crossOuTransferInUseTransitReceive:
          "Farkli operating-unit baglamlari arasindaki transfer-in icin Transit Teslim Al aksiyonunu kullanin.",
        expectedCounterpartyTypeForTxn:
          "{{txnType}} icin beklenen muhatap tipi {{expected}}.",
        recommendCounterpartyType:
          "Daha iyi apply uyumlulugu icin muhatap tipini {{expected}} yapin.",
        sessionModeNone:
          "Secili register session_mode=NONE. cashSessionId bos birakilabilir.",
        sessionRequiredNoOpen:
          "Secili register icin OPEN oturum bulunmuyor; create/post akisi bloklanabilir.",
      },
      errors: {
        missingReadPermission:
          "Bu sayfayi kullanmak icin cash.txn.read yetkisi gerekir.",
        missingCreatePermission:
          "Bu islem icin cash.txn.create yetkisi gerekir.",
        missingPostPermission: "Bu islem icin cash.txn.post yetkisi gerekir.",
        missingCancelPermission:
          "Bu islem icin cash.txn.cancel yetkisi gerekir.",
        missingReversePermission:
          "Bu islem icin cash.txn.reverse yetkisi gerekir.",
        missingOverridePermission:
          "Bu islem icin cash.override.post yetkisi gerekir.",
        load: "Kasa islemleri yuklenemedi.",
        create: "Kasa islemi olusturulamadi.",
        action: "Islem aksiyonu tamamlanamadi.",
        requestId: "Talep ID: {{requestId}}",
        actionRowMissing: "Aksiyon icin gecerli islem bulunamadi.",
        openDocumentsPermissionMissing:
          "Acik belge secici icin cari.report.read yetkisi gerekir.",
        openDocumentsLoadNotAllowedForRow:
          "Secilen islem icin Cari acik belgeleri yuklenemiyor.",
        openDocumentsLoadFailed: "Cari apply icin acik belgeler yuklenemedi.",
        registerRequired: "registerId zorunludur.",
        txnDatetimeRequired: "txnDatetime zorunludur.",
        bookDateRequired: "bookDate zorunludur.",
        amountRequired: "amount zorunludur.",
        amountInvalid: "amount gecersiz.",
        currencyRequired: "currencyCode zorunludur.",
        invalidTxnType: "Gecersiz islem tipi.",
        counterAccountRequired:
          "Bu islem tipi icin counterAccountId zorunludur.",
        counterRegisterRequired:
          "Bu islem tipi icin counterCashRegisterId zorunludur.",
        counterRegisterSame:
          "counterCashRegisterId registerId ile ayni olamaz.",
        registerInactive: "Secili register ACTIVE degil.",
        crossOuTransferInMustUseTransitReceive:
          "Farkli operating-unit baglamlari arasindaki transfer-in, Transit Teslim Al aksiyonu ile olusturulmalidir.",
        missingApplyCariPermission:
          "Bu islem icin cari.settlement.apply yetkisi gerekir.",
        transitTransferLinkMissing:
          "Bu satirda transit transfer baglantisi bulunamadi.",
        transitTransferIdRequired: "transitTransferId zorunludur.",
        onlyReceiptPayoutCanApplyCari:
          "Yalnizca RECEIPT/PAYOUT islemleri Cari'ye uygulanabilir.",
        applyCounterpartyTypeMismatch:
          "Islem icin counterpartyType={{expected}} ve gecerli bir counterpartyId gerekir.",
        settlementDateRequired: "settlementDate zorunludur.",
        overApplyDetected:
          "Fazla uygulama tespit edildi (openItemId={{openItemId}}).",
        applySelectedTotalExceedsCashAmount:
          "Secilen uygulama toplami kasa islem tutarini asiyor.",
        currencyMismatch:
          "Islem para birimi register para birimi ile uyusmuyor (register: {{registerCurrency}}).",
        maxAmountExceeded:
          "Islem tutari register maxTxnAmount limitini asiyor (max: {{max}}).",
        sessionRequiredNoOpen:
          "Secili register icin OPEN oturum yok; islem olusturulamadi.",
        postStatusInvalid:
          "Yalnizca DRAFT/SUBMITTED/APPROVED islemler post edilebilir.",
        cancelStatusInvalid:
          "Yalnizca DRAFT/SUBMITTED islemler iptal edilebilir.",
        reverseStatusInvalid: "Yalnizca POSTED islemler ters kayit edilebilir.",
        reverseReversalNotAllowed:
          "Ters kayit satirlari tekrar ters kayit edilemez.",
        overrideReasonRequired:
          "overrideCashControl=true icin overrideReason zorunludur.",
        cancelReasonRequired: "cancelReason zorunludur.",
        reverseReasonRequired: "reverseReason zorunludur.",
      },
      errorsMapped: {
        registerNotFound: "Secilen register bulunamadi.",
        sessionNotFound: "Secilen oturum bulunamadi.",
        sessionRegisterMismatch: "Secilen oturum register ile eslesmiyor.",
        sessionNotOpen: "Secilen oturum OPEN degil.",
        counterRegisterNotFound: "Karsi register bulunamadi.",
        counterAccountInvalid:
          "Karsi hesap gecersiz veya tenant kapsaminda degil.",
        counterAccountInvalidBank:
          "Banka islemleri icin karsi hesap, secili legal entity icindeki aktif bir banka GL hesabi olmalidir.",
        postRequiresOpenSession: "Post islemi icin OPEN oturum gereklidir.",
        currencyMismatchGeneric:
          "Islem para birimi register para birimi ile uyusmuyor.",
        maxAmountExceededGeneric:
          "Islem tutari register maxTxnAmount limitini asiyor.",
        transactionNotFound: "Secilen kasa islemi bulunamadi.",
        idempotencyDuplicate:
          "Ayni idempotency anahtari ile daha once bir islem olusturulmus.",
        systemGeneratedOnly:
          "Bu islem tipi yalnizca sistem tarafindan olusturulabilir.",
        transitSourceTargetOuMismatch:
          "Transit akisi, kaynak ve hedef register'in farkli operating-unit baglamlarinda olmasini gerektirir.",
        transitCrossLegalEntityNotSupported:
          "Cross-legal-entity transit transfer desteklenmiyor.",
        transitMustBeInTransitBeforeReceive:
          "Transit transfer teslim almadan once IN_TRANSIT durumunda olmalidir.",
        transitTransferOutMustBePostedBeforeReceive:
          "Teslim almadan once transfer-out islemi POSTED olmalidir.",
        transitAlreadyReceived: "Transit transfer zaten teslim alinmis.",
        transitReverseTransferInFirst:
          "Transfer-out ters kaydi oncesi once transfer-in ters kaydini alin.",
        ouSelfBalancingSetupInvalid:
          "Gerekli merkez-OU veya sube-cifti cari hesap kurulumlari hazir olmadigi icin farkli baglam transfer post islemi engellendi. Kaydedilen cari hesap konfigurasyonunu Transfer Out sirasinda Kasa Islemleri ekranindan ya da Organizasyon Yonetimi icinden calistirin.",
        applyRequiresPostedTxn: "Cari apply icin kasa islemi POSTED olmalidir.",
        applyCounterpartyInvalid:
          "Cari apply icin kasa islemi muhatap bilgisi gecersiz.",
        applyTotalExceedsAvailable:
          "Uygulanan toplam kullanilabilir tutari asiyor.",
        applyOpenItemResidualExceeded:
          "Secilen uygulama tutari acik belge bakiyesini asiyor.",
        applyNoOpenDocs: "Secilen muhatap icin acik Cari belgesi bulunamadi.",
        applyAlreadyLinked:
          "Bu kasa islemi zaten baska bir Cari settlement ile bagli.",
      },
      messages: {
        created: "Kasa islemi olusturuldu.",
        posted: "Kasa islemi post edildi.",
        cancelled: "Kasa islemi iptal edildi.",
        reversed: "Ters kayit olusturuldu. Reversal ID: {{reversalId}}.",
        transitReplay:
          "Transit transfer tekrarlandi (replay). transferId={{transferId}}",
        transitInitiated:
          "Transit baslatildi. transferId={{transferId}}, transferOutTxnId={{transferOutTxnId}}",
        transitReceiveReplay:
          "Transit teslim alma tekrarlandi (replay). transferInTxnId={{transferInTxnId}}",
        transitReceived:
          "Transit teslim alindi. transferInTxnId={{transferInTxnId}}",
        applyReplayReturned:
          "Apply istegi replay edildi; mevcut Cari baglantisi geri donduruldu.",
        applyCompletedSettlement:
          "Cari apply tamamlandi. settlementBatchId={{settlementBatchId}}",
        applyCreatedUnapplied:
          "Cari unapplied cash olusturuldu. unappliedCashId={{createdUnappliedCashId}}",
        applyCompleted: "Cari apply tamamlandi.",
        idempotentReplay:
          "Bu istek daha once islenmis; mevcut kayit geri donduruldu.",
      },
    },
    cashExchanges: {
      sections: {
        exchangeBatches: "Kur Degisim Batch'leri",
        createExchangeBatch: "Kur Degisim Batch'i Olustur",
        selectedBatchDetail: "Secili Batch Detayi",
      },
      postingModes: {
        clearing: "CLEARING (asamali FX)",
        direct: "DIRECT (kasadan kasaya)",
      },
      form: {
        postingMode: "Posting Modu",
        directModeHelp:
          "Direct mod, kaynak kasa ile hedef kasa arasinda asamali clearing hesabi kullanmadan post eder.",
        clearingModeHelp:
          "FX degisimi tamamlanmadan once tutari bir clearing hesabinda bekletmek istiyorsaniz staged clearing kullanin.",
        clearingAccount: "Clearing Hesabi",
        directModeNoClearing: "Direct modda clearing hesabi kullanilmaz.",
        clearingAccountHelp:
          "GL setup icinde CASH_EXCHANGE_CLEARING tanimliysa buraya otomatik gelir. Asamali FX clearing icin 108 altinda ayrilmis bir 108.xx varlik hesabi iyi bir tercihtir.",
        commissionAmountTxn: "Komisyon Tutari (Islem)",
        commissionAmountBase: "Komisyon Tutari (Baz)",
        commissionAccount: "Komisyon Hesabi",
        selectCommissionAccount: "Secin",
        commissionHelp:
          "Komisyon opsiyoneldir. Girildiginde komisyon hesabi zorunludur.",
        spreadReferenceRate: "Spread Referans Kuru",
        spreadRateDelta: "Spread Kur Farki",
        spreadAmountBase: "Spread Tutari (Baz)",
        searchClearingAccount: "Clearing hesap kodu/adi ara",
        selectSourceRegisterFirst: "Once kaynak register secin",
        noClearingAccounts: "Clearing hesabi bulunamadi.",
      },
      values: {
        clearingUsage: "Clearing",
        noClearing: "Clearing yok",
        commissionAmount: "Komisyon",
        spreadAmount: "Spread",
        commissionAccount: "Komisyon Hesabi",
        noCommissionAccount: "Komisyon hesabi yok",
      },
      detail: {
        selectPrompt:
          "Bagli islemleri incelemek icin tablodan bir batch numarasi secin.",
        loading: "Batch detayi yukleniyor...",
        postingMode: "Posting Modu",
        clearingUsage: "Clearing Kullanimi",
        commissionAccount: "Komisyon Hesabi",
        commissionAmount: "Komisyon Tutari",
        spreadAmount: "Spread Tutari",
        sourceRegister: "Kaynak Register",
        targetRegister: "Hedef Register",
        exchangeTransactions: "Degisim Islemleri",
        sourceTxn: "Cikis",
        targetTxn: "Giris",
        rawJson: "Ham JSON",
      },
      actions: {
        saving: "Kaydediliyor...",
        create: "Kur Degisimi Olustur",
      },
      table: {
        loading: "Kur degisim batch'leri yukleniyor...",
        empty: "Kur degisim batch'i bulunamadi.",
      },
      errors: {
        missingCreatePermission: "Eksik yetki: cash.txn.create",
        registersRequired: "sourceRegisterId ve targetRegisterId zorunludur.",
        registersMustDiffer:
          "sourceRegisterId ve targetRegisterId farkli olmali.",
        amountsRequired:
          "sourceAmountTxn ve targetAmountTxn pozitif sayi olmalidir.",
        idempotencyRequired: "idempotencyKey zorunludur.",
        fxRateInvalid: "FX rate pozitif sayi olmali.",
        commissionAmountTxnInvalid:
          "Komisyon tutari (islem) pozitif sayi olmali.",
        commissionAmountBaseInvalid:
          "Komisyon tutari (baz) pozitif sayi olmali.",
        spreadReferenceRateInvalid: "Spread referans kuru pozitif sayi olmali.",
        spreadAmountBaseInvalid: "Spread tutari (baz) pozitif sayi olmali.",
        spreadRateDeltaInvalid: "Spread kur farki sayisal olmali.",
        commissionAccountRequired:
          "Komisyon tutari girildiginde komisyon hesabi zorunludur.",
        commissionAmountRequired:
          "Komisyon hesabi girildiginde komisyon tutari zorunludur.",
        create: "Kur degisimi olusturulamadi.",
      },
      messages: {
        savedWithId: "Kur degisim batch #{{id}} basariyla kaydedildi.",
        saved: "Kur degisim batch basariyla kaydedildi.",
      },
    },
    cashExceptions: {
      title: "Kasa Istisnalari",
      subtitle:
        "Kasa oturumlari ve kasa islemlerinden turetilen operasyonel istisnalari izleyin.",
      glWarningNote:
        "Bu ekranda cash endpointlerinden turetilen istisnalar ile birlikte dogrudan GL cash-control olaylari da listelenir.",
      requestId: "Talep ID: {{requestId}}",
      sections: {
        filters: "Filtreler",
        highVariance: "Yuksek Fark Oturumlari",
        forcedClose: "Zorunlu Kapatilan Oturumlar",
        overrideUsage: "Override Kullanilan Islemler",
        unposted: "Post Edilmemis Islemler",
        glCashControlEvents: "Dogrudan GL Cash-Control Olaylari",
        notes: "Notlar",
      },
      actions: {
        apply: "Filtreyi Uygula",
        clear: "Temizle",
        refresh: "Yenile",
        loading: "Yukleniyor...",
      },
      filters: {
        allLegalEntities: "Tum legal entityler",
        allOperatingUnits: "Tum operating unitler",
        allRegisters: "Tum registerlar",
        fromDate: "Baslangic Tarihi",
        toDate: "Bitis Tarihi",
        minAbsVariance: "Minimum mutlak fark",
      },
      cards: {
        highVariance: "Yuksek Fark",
        forcedClose: "Forced Close",
        overrideUsage: "Override Kullanimi",
        unposted: "Post Edilmemis",
        glCashControlEvents: "GL Cash-Control",
      },
      table: {
        register: "Register",
        legalEntity: "Legal Entity",
        operatingUnit: "Operating Unit",
        status: "Durum",
        expected: "Beklenen",
        counted: "Sayilan",
        variance: "Fark",
        closedAt: "Kapanis Zamani",
        closedReason: "Kapanis Nedeni",
        closeNote: "Kapanis Notu",
        closedBy: "Kapatan",
        txnNo: "Islem No",
        txnType: "Islem Tipi",
        bookDate: "Book Date",
        amount: "Tutar",
        overrideReason: "Override Nedeni",
        postedJournal: "Post Journal",
        createdAt: "Olusturma Zamani",
        action: "Aksiyon",
        journalNo: "Journal No",
        resource: "Kaynak",
        scope: "Scope",
        requestId: "Talep ID",
        payload: "Icerik",
      },
      empty: {
        highVariance: "Filtrelere uygun yuksek farkli oturum bulunamadi.",
        forcedClose: "Filtrelere uygun forced close oturum bulunamadi.",
        overrideUsage: "Filtrelere uygun override kaydi bulunamadi.",
        unposted: "Filtrelere uygun post edilmemis islem bulunamadi.",
        glCashControlEvents:
          "Filtrelere uygun dogrudan GL cash-control olayi bulunamadi.",
      },
      values: {
        glActionWarn: "Uyari",
        glActionOverride: "Override",
      },
      errors: {
        missingReadPermission:
          "Bu sayfayi kullanmak icin cash.report.read yetkisi gerekir.",
        invalidVarianceThreshold:
          "Minimum mutlak fark degeri sifir veya pozitif bir sayi olmalidir.",
        invalidDateRange: "Baslangic tarihi bitis tarihinden buyuk olamaz.",
        load: "Kasa istisna verileri yuklenemedi.",
      },
      warnings: {
        registerLookupUnavailable:
          "Register lookup verileri yuklenemedi; filtre secenekleri kisitli olabilir.",
        sessionsUnavailable:
          "Kasa oturum verileri gecici olarak alinamadi; istisna bolumleri kismi gosteriliyor.",
        transactionsUnavailable:
          "Kasa islem verileri gecici olarak alinamadi; istisna bolumleri kismi gosteriliyor.",
      },
    },
    cariCounterparty: {
      accountPickerPermissionMissing:
        "gl.account.read yetkisi olmadigi icin AR/AP hesap secicileri gizlendi.",
      accountPickerLoadError:
        "Secilen legal entity icin hesap secenekleri yuklenemedi.",
      arAccountLabel: "AR Kontrol Hesabi Override",
      apAccountLabel: "AP Kontrol Hesabi Override",
    },
    cariDocuments: {
      title: "Cari Belgeler",
      createDraft: "Taslak belge olustur",
      updateDraft: "Taslak belgeyi guncelle",
      cancelDraft: "Taslagi iptal et",
      postDraft: "Taslagi post et",
      reversePosted: "Post edileni ters kaydet",
    },
    cariAudit: {
      title: "Cari Denetim Izleri",
      subtitle:
        "Finance/support incelemeleri icin audit log kayitlarini filtreleyin ve requestId ile izleyin.",
      byActionTitle: "Aksiyon Ozeti",
    },
    cariSettlements: {
      title: "Cari Mahsuplastirma / Tahsilat-Odeme",
      apply: "Mahsuplastirma uygula",
      reverse: "Mahsuplastirmayi ters kaydet",
      replayInfo: "Bu istek daha once uygulanmis; mevcut sonuc gosteriliyor.",
      directionRequired: "Auto-allocation icin direction zorunludur.",
      mixedDirectionWarning:
        "Open-item satirlari AR/AP karisik. Auto-allocation icin tek direction secin.",
    },
    modulePlaceholder: {
      defaultTitle: "Modul",
      description:
        "Bu modul rotasi aktif, ancak tam ekran ve is akisi henuz uygulanmadi.",
      routeLabel: "Rota:",
      yearEndReminder: {
        title: "Yil sonu notu (placeholder)",
        description:
          "Daha sonra detaylandirilacak kontrol listesi icin iz: uzun/kisa vade aktarmalari ve tahakkuk kapama adimlarini dogrulayin.",
        reclassDeferredRevenue:
          "Ertelenmis gelir uzun->kisa aktarimlarini kontrol edin (480 -> 380).",
        reclassPrepaidExpense:
          "Pesin gider uzun->kisa aktarimlarini kontrol edin (280 -> 180).",
        reclassAccruedRevenue:
          "Gelir tahakkuku uzun->kisa aktarimlarini kontrol edin (281 -> 181).",
        reclassAccruedExpense:
          "Gider tahakkuku uzun->kisa aktarimlarini kontrol edin (481 -> 381).",
        closeAccruals:
          "Donem sonunda tahakkuk/ertelenmis bakiye kapama ve sonraki doneme acilis kontrollerini planlayin.",
      },
    },
    readinessChecklist: {
      title: "Kiraci Temel Kurulum Kontrol Listesi",
      loading: "Temel kurulum bilgisi yukleniyor...",
      retry: "Tekrar Dene",
      refresh: "Yenile",
      showDetails: "Detaylari Goster",
      hideDetails: "Detaylari Gizle",
      summary: "{{ready}} / {{total}} tamam",
      description:
        "Legal entity aktivasyonuna gecmeden once kiraci iskeleti, organizasyon ve GL temel kurulumunu tamamlayin.",
      minimum: "{{count}} / minimum {{minimum}}",
      missing: "Eksikler:",
      setupStepsTitle: "Eksik adimlar icin yonlendirme",
      checkLabels: {
        groupCompanies: "Grup sirketleri",
        legalEntities: "Istirak / bagli ortaklar",
        fiscalCalendars: "Mali takvimler",
        fiscalPeriods: "Mali donemler",
        books: "Defterler",
        openBookPeriods: "Acik defter donemleri",
        chartsOfAccounts: "Hesap planlari",
        accounts: "Hesaplar",
        subaccountsV1: "Subaccounts V1 (uyari placeholder)",
        setupWizardV2: "Setup Wizard V2 (uyari placeholder)",
        consolidationCanonicalMappingV1:
          "Konsolidasyon kanonik esleme (uyari placeholder)",
        taxEngineV1: "Ulke vergi motoru kurulumu (opsiyonel)",
      },
      badges: {
        ready: "Hazir",
        setupRequired: "Kurulum Gerekli",
        ok: "Tamam",
        missing: "Eksik",
      },
      links: {
        company: "Sirket Kurulumu",
        org: "Organizasyon Kurulumu",
        gl: "GL Kurulumu",
      },
      bootstrap: {
        title: "Tek tikla temel kurulum",
        run: "Temel Kurulumu Calistir",
        running: "Calisiyor...",
        missingPermission: "Eksik yetki: onboarding.company.setup",
        completed: "Temel kurulum tamamlandi.",
      },
    },
    readinessGuard: {
      checking: "Kiraci temel kurulum durumu kontrol ediliyor...",
      failedTitle: "Kiraci temel kurulum kontrolu basarisiz",
      retry: "Tekrar Dene",
    },
    chartOfAccountsCreate: {
      title: "Hesap Plani Olustur",
    },
  },
  en: {
    language: {
      switchLabel: "Language switcher",
      tr: "TR",
      en: "EN",
    },
    layout: {
      expandSidebar: "Expand sidebar",
      collapseSidebar: "Collapse sidebar",
      financeConsole: "Finance Console",
      proSidebar: "Pro Sidebar",
      myAccount: "My Account",
      loggedInUser: "Logged in user",
      logout: "Logout",
      workspace: "Workspace",
      breadcrumbAria: "Breadcrumb",
      openSidebar: "Open sidebar",
      userFallback: "User",
      madeWithLoveBy: "made with love by",
      readinessChecking: "Bootstrap: Checking",
      readinessError: "Bootstrap: Error",
      readinessReady: "Tenant bootstrap complete",
      readinessSetupRequired: "Tenant bootstrap required",
      readinessChecklist: "Bootstrap checklist",
      readinessStages: "Readiness stages",
      readinessAllSet: "All required bootstrap steps are complete.",
      readinessMissingItems: "Missing items",
      readinessRefresh: "Refresh",
      readinessOpenSetup: "Open setup",
      bootstrapCompleted: "Tenant bootstrap complete",
      bootstrapCompletedActivationChecking:
        "Tenant bootstrap complete • Checking activation summary",
      bootstrapCompletedActivationError:
        "Tenant bootstrap complete • Activation summary unavailable",
      bootstrapCompletedActivationPendingSingular:
        "Tenant bootstrap complete • 1 legal entity needs activation",
      bootstrapCompletedActivationPendingPlural:
        "Tenant bootstrap complete • {{count}} legal entities need activation",
      bootstrapCompletedActivationReady:
        "Tenant bootstrap complete • All visible legal entities are ready",
      activationSectionTitle: "Legal-entity activation",
      activationChecking: "Checking activation summary.",
      activationError: "Activation summary could not be loaded.",
      activationNoVisibleEntities: "No legal entities are visible in the current scope.",
      activationPendingSingular: "1 legal entity needs activation",
      activationPendingPlural: "{{count}} legal entities need activation",
      activationPendingDescriptionSingular:
        "1 visible legal entity still has blocking activation tasks.",
      activationPendingDescriptionPlural:
        "{{count}} visible legal entities still have blocking activation tasks.",
      activationAllSet: "All visible legal entities are ready.",
      activationAllSetDescription:
        "No activation blockers remain across {{count}} visible legal entities.",
      activationOpenWorkspace: "Open activation workspace",
      activationRowReady: "Ready",
      activationRowPending: "Pending",
      activationMoreRows: "+{{count}} more",
      currentEntityActivationReady: "Current entity ready",
      currentEntityActivationPending: "Current entity needs activation",
    },
    login: {
      title: "Login",
      email: "Email",
      password: "Password",
      signIn: "Sign in",
      signingIn: "Signing in...",
      failed: "Login failed",
      forgotPassword: "Forgot password",
      providerAdminSignIn: "Provider Admin Sign In",
    },
    passwordResetRequest: {
      title: "Password Reset",
      emailLabel: "Email",
      resetLinkReady: "Password reset link ready:",
      messages: {
        requested: "If the email exists, a reset link has been generated.",
        linkCopied: "Reset link copied.",
      },
      errors: {
        requestFailed: "Failed to request password reset.",
        copyFailed: "Failed to copy reset link.",
      },
      actions: {
        submit: "Generate Reset Link",
        submitting: "Generating...",
        copyLink: "Copy Link",
        backToLogin: "Back to Login",
      },
    },
    passwordResetComplete: {
      title: "Set New Password",
      loading: "Checking reset token...",
      emailLabel: "Email",
      statusLabel: "Status",
      passwordLabel: "New password",
      passwordConfirmLabel: "Confirm new password",
      messages: {
        completed: "Password updated successfully. You can sign in now.",
      },
      errors: {
        missingToken: "Reset token is missing.",
        loadFailed: "Failed to load reset token.",
        completeFailed: "Failed to reset password.",
        passwordMismatch: "Passwords must match.",
      },
      actions: {
        submit: "Update Password",
        submitting: "Updating...",
        backToLogin: "Back to Login",
      },
    },
    inviteAccept: {
      title: "Complete Invitation",
      loading: "Loading invitation details...",
      emailLabel: "Email",
      statusLabel: "Status",
      nameLabel: "Full name",
      passwordLabel: "Password",
      passwordConfirmLabel: "Confirm password",
      messages: {
        accepted: "Invitation accepted. You can now sign in.",
      },
      errors: {
        missingToken: "Invite token is missing.",
        loadFailed: "Failed to load invitation.",
        acceptFailed: "Failed to accept invitation.",
        passwordMismatch: "Passwords must match.",
      },
      actions: {
        submit: "Activate Account",
        submitting: "Activating...",
        goToLogin: "Go to Login",
      },
    },
    authGuards: {
      loading: "Loading...",
      accessDeniedTitle: "Access denied",
      accessDeniedDescription:
        "Your user is authenticated but does not have the required permission for this module.",
      requiredPermissionsLabel: "Required permissions:",
      missingPermissionLine: "Missing permission: {{permission}}",
      scopeMismatchDescription:
        "You have this permission, but not for the selected scope.",
      visibilityNarrowedDescription:
        "Visibility is narrowed to assigned scopes, so some records or actions may still stay unavailable.",
      providerSessionLoading: "Loading provider session...",
    },
    providerLogin: {
      title: "Provider Admin Login",
      subtitle: "Sign in to manage tenants from the control plane.",
      email: "Email",
      password: "Password",
      emailPlaceholder: "provider-admin@example.com",
      passwordPlaceholder: "********",
      signIn: "Sign in",
      signingIn: "Signing in...",
      failed: "Provider login failed",
      backToUserLogin: "Back to User Login",
    },
    providerBootstrap: {
      title: "Provider Tenant Admin Panel",
      subtitle:
        "Create and manage tenant subscriptions from the control plane.",
      signedInAs: "Signed in as",
      providerAdminFallback: "Provider Admin",
      logout: "Log out",
      statuses: {
        ACTIVE: "Active",
        SUSPENDED: "Suspended",
      },
      errors: {
        loadTenants: "Failed to load tenants.",
        provisionFailed: "Tenant provisioning failed.",
        updateStatus: "Failed to update tenant status.",
        updateTaxEngine: "Failed to update tenant tax engine setting.",
        restoreBootstrapRoles: "Failed to restore bootstrap roles.",
        loadCountries: "Failed to load countries.",
        loadCurrencies: "Failed to load currencies.",
        createCurrency: "Currency creation failed.",
        updateCurrency: "Failed to update currency.",
        createCountry: "Country creation failed.",
        updateCountry: "Failed to update country.",
      },
      messages: {
        created: "Tenant and first admin were created successfully.",
        statusUpdated: "Tenant #{{id}} status updated to {{status}}.",
        taxEngineUpdated: "Tenant #{{id}} tax engine updated to {{status}}.",
        bootstrapRolesRestored:
          "SecurityAdmin + SystemAdmin were restored for {{email}} in tenant #{{id}}.",
        currencyCreated: "Currency record created.",
        currencyUpdated: "Currency {{code}} updated.",
        countryCreated: "Country record created.",
        countryUpdated: "Country #{{id}} updated.",
      },
      createTenant: {
        title: "Create Tenant",
        fields: {
          enableTaxEngine: "Enable country tax engine",
          enableTaxEngineHelp:
            "Writes FEATURE_TAX_ENGINE_V1 into tenant feature flags during tenant provisioning.",
        },
        placeholders: {
          tenantCode: "Tenant code (e.g. ACME)",
          tenantName: "Tenant name",
          adminName: "Admin full name",
          adminEmail: "Admin email",
          adminPassword: "Admin password (min 8 chars)",
        },
        actions: {
          provisioning: "Provisioning...",
          create: "Create tenant",
        },
        result: {
          title: "Provision Result",
          tenant: "Tenant: #{{id}} ({{code}})",
          admin: "Admin: #{{id}} ({{email}})",
          roleId: "Role ID: {{id}}",
          taxEngine: "Tax engine: {{status}}",
          enabled: "Enabled",
          disabled: "Disabled",
        },
      },
      directory: {
        title: "Tenant Directory",
        loading: "Loading...",
        refresh: "Refresh",
        searchPlaceholder: "Search by tenant code or name",
        search: "Search",
        columns: {
          code: "Code",
          name: "Name",
          status: "Status",
          taxEngine: "Tax engine",
          users: "Users",
          actions: "Actions",
        },
        actions: {
          activate: "Activate",
          suspend: "Suspend",
          restoreBootstrap: "Restore bootstrap roles",
          restoringBootstrap: "Restoring...",
          restoreBootstrapPrompt:
            "Enter the tenant user email that should receive SecurityAdmin + SystemAdmin again for tenant {{code}}.",
        },
        taxEngine: {
          label: "Country tax engine",
          enabled: "Enabled",
          disabled: "Disabled",
          updating: "Saving...",
        },
        empty: "No tenant records found.",
      },
      currencies: {
        title: "Currency Master Management",
        subtitle: "Country default currencies are selected from this list.",
        loading: "Loading...",
        refresh: "Refresh",
        searchPlaceholder: "Search by code or name",
        immutableCodeNote:
          "Code (ISO 4217) is immutable on this screen after creation.",
        create: {
          title: "Add New Currency",
          placeholders: {
            code: "Code (e.g. USD)",
            name: "Currency name",
            minorUnits: "Minor units (0-9)",
          },
          actions: {
            creating: "Creating...",
            create: "Create currency",
          },
        },
        columns: {
          code: "Code",
          name: "Name",
          minorUnits: "Minor units",
          actions: "Actions",
        },
        actions: {
          edit: "Edit",
          save: "Save",
          cancel: "Cancel",
        },
        empty: "No currency records found.",
      },
      countries: {
        title: "Country Master Management",
        subtitle:
          "Tenant UI consumes this list as select-only; country codes are managed from provider panel.",
        loading: "Loading...",
        refresh: "Refresh",
        searchPlaceholder: "Search by ISO code, name, or currency",
        search: "Search",
        immutableCodesNote:
          "ISO2/ISO3 codes are immutable on this screen after creation.",
        create: {
          title: "Add New Country",
          placeholders: {
            iso2: "ISO2 (e.g. TR)",
            iso3: "ISO3 (e.g. TUR)",
            name: "Country name",
            defaultCurrencyCode: "Select default currency",
          },
          actions: {
            creating: "Creating...",
            create: "Create country",
          },
        },
        columns: {
          iso2: "ISO2",
          iso3: "ISO3",
          name: "Name",
          defaultCurrencyCode: "Default currency",
          actions: "Actions",
        },
        actions: {
          edit: "Edit",
          save: "Save",
          cancel: "Cancel",
        },
        empty: "No country records found.",
      },
    },
    dashboard: {
      title: "Dashboard",
      subtitle: "This is inside the protected /app area.",
      cards: {
        periodCloseBlockers: "Close & Readiness Blockers",
        periodCloseBlockersHint:
          "Failed close checks plus open tenant/module readiness blockers.",
      },
    },
    notFound: {
      title: "Page not found",
      goToApp: "Go to app",
    },
    breadcrumbs: {
      byPath: {
        "/login": "Login",
        "/provider/bootstrap": "Provider Bootstrap",
      },
    },
    sidebar: {
      titles: {
        "donem-islemleri": "Period Operations",
        kasa: "Cash",
        "yevmiye-kayitlari": "Journal Entries",
        "kasa-hazirlik-ve-oturum": "Cash Setup and Sessions",
        "gunluk-nakit-islemleri": "Daily Cash Operations",
        "kontrol-ve-mahsup": "Controls and Journal",
        "banka-islemleri": "Banking Operations",
        "odeme-islemleri": "Payments",
        "bordro-islemleri": "Payroll",
        satinalma: "Purchases",
        satis: "Sales",
        "cari-islemler": "Current Accounts",
        "cari-kartlar": "Counterparty Cards",
        "cari-belge-ve-mutabakat": "Documents and Settlements",
        "cari-rapor-ve-denetim": "Reports and Audit",
        "sozlesme-ve-gelir": "Contracts and Revenue",
        stoklar: "Inventory",
        demirbaslar: "Fixed Assets",
        "donem-sonu-islemler": "Period End Operations",
        "aylik-donem-sonu-islemler": "Month-End Operations",
        "yillik-donem-sonu-islemleri": "Year-End Operations",
        raporlar: "Reports",
        "benim-ayarlarim": "My Settings",
        "platform-kurulumu": "Platform Setup",
        "kullanici-ve-erisim-yonetimi": "Security Administration",
        ayarlar: "Settings",
      },
      byPath: {
        "/app": "Dashboard",
        "/app/donem-islemleri": "Period Operations",
        "/app/acilis-fisi": "Create Opening Voucher",
        "/app/journal-entries": "Journal Entry",
        "/app/tediye-islemleri": "Payments",
        "/app/tahsilat-islemleri": "Collection",
        "/app/kasa-tanimlari": "Cash Registers",
        "/app/kasa-oturumlari": "Cash Sessions",
        "/app/kasa-islemleri": "Cash Transactions",
        "/app/kasa-transit-transferleri": "Cash Transit Transfers",
        "/app/kasa-kur-degisimleri": "Cash FX Exchanges",
        "/app/kasa-kur-raporlari": "Cash FX Reports",
        "/app/kasa-kur-ops-dashboard": "Cash FX Ops Dashboard",
        "/app/kasa-istisnalari": "Cash Exceptions",
        "/app/mahsup-islemleri": "Adjustment",
        "/app/banka-islemleri": "Banking Operations",
        "/app/banka-tanimla": "Define Bank",
        "/app/banka-ekstre-ice-aktar": "Bank Statement Import",
        "/app/banka-ekstre-kuyrugu": "Bank Statement Queue",
        "/app/banka-mutabakat": "Bank Reconciliation",
        "/app/banka-onaylar": "Bank Approvals",
        "/app/ayarlar/operasyon-dashboard": "Operations Dashboard",
        "/app/ayarlar/exception-workbench": "Exception Workbench",
        "/app/ayarlar/veri-saklama-snapshot": "Retention and Snapshots",
        "/app/odeme-batchleri": "Payment Batches",
        "/app/payroll-runs": "Payroll Runs",
        "/app/payroll-runs/import": "Payroll Import",
        "/app/payroll-mappings": "Payroll Mappings",
        "/app/payroll-ownership": "Payroll Ownership",
        "/app/payroll-liabilities": "Payroll Liabilities",
        "/app/payroll-beneficiaries": "Payroll Beneficiaries",
        "/app/payroll-close-controls": "Payroll Close Controls",
        "/app/cari-islemler": "Current Accounts",
        "/app/alici-kart-olustur": "Create Customer Card",
        "/app/alici-kart-listesi": "Customers",
        "/app/musteri-kartlari/olustur": "Create Customer Card",
        "/app/musteri-kartlari": "Customers",
        "/app/satici-kart-olustur": "Create Vendor Card",
        "/app/satici-kart-listesi": "Vendors",
        "/app/tedarikci-kartlari/olustur": "Create Vendor Card",
        "/app/tedarikci-kartlari": "Vendors",
        "/app/cari-belgeler": "Cari Documents",
        "/app/cari-belgeler?direction=AP": "Vendor Bills",
        "/app/cari-belgeler?direction=AR": "Sales Invoices",
        "/app/alis-faturalari": "Vendor Bills",
        "/app/satis-faturalari": "Sales Invoices",
        "/app/cari-raporlari": "Cari Reports",
        "/app/cari-raporlari?direction=AP": "Vendor Reports",
        "/app/cari-raporlari?direction=AP&report=balances": "AP Balances",
        "/app/cari-raporlari?direction=AR": "Customer Reports",
        "/app/cari-raporlari?direction=AR&report=balances": "AR Balances",
        "/app/tedarikci-raporlari": "Vendor Reports",
        "/app/musteri-raporlari": "Customer Reports",
        "/app/cari-settlements": "Cari Settlements / Collection-Payment",
        "/app/cari-settlements?direction=AP": "AP Payments",
        "/app/cari-settlements?direction=AR": "AR Receipts",
        "/app/tedarikci-odemeler": "AP Payments",
        "/app/musteri-tahsilatlar": "AR Receipts",
        "/app/cari-audit": "Cari Audit Trails",
        "/app/ayarlar/cari-denetim": "Cari Audit Trails",
        "/app/contracts": "Contracts",
        "/app/sozlesmeler": "Contracts",
        "/app/contracts-and-revenue": "Contracts",
        "/app/gelecek-yillar-gelirleri": "Periodization and Accruals",
        "/app/donemsellik-ve-tahakkuklar": "Periodization and Accruals",
        "/app/periodization-and-accruals": "Periodization and Accruals",
        "/app/stoklar": "Inventory",
        "/app/stok-karti-olustur": "Create Stock Card",
        "/app/stok-yansitma-islemleri": "Stock Reflection Transactions",
        "/app/stok-transferleri": "Inventory Transfers",
        "/app/stok-maliyet-voucherleri": "Stock Landed Cost Vouchers",
        "/app/stok-maliyet-voucherleri/yeni": "New Stock Landed Cost Voucher",
        "/app/stok-karti-listesi": "Stock Card List",
        "/app/demirbaslar": "Fixed Assets",
        "/app/demirbas-karti-listesi": "Fixed Asset Register",
        "/app/demirbas-karti-olustur": "Create Fixed Asset",
        "/app/demirbas-alim-islemleri": "Fixed Asset Acquisitions",
        "/app/demirbas-satis-islemleri": "Fixed Asset Disposals",
        "/app/demirbas-ops-dashboard": "Fixed Asset Ops Dashboard",
        "/app/demirbas-amortisman-islemleri": "Depreciation Runs",
        "/app/donem-sonu-islemler": "Period End Operations",
        "/app/donem-sonu-islemler/aylik": "Month-End Operations",
        "/app/donem-sonu-islemler/aylik/degerleme-islemleri":
          "Revaluation Transactions",
        "/app/donem-sonu-islemler/aylik/amortisman-islemleri":
          "Depreciation Transactions",
        "/app/donem-sonu-islemler/aylik/beyanname-islemleri":
          "Declaration Transactions",
        "/app/donem-sonu-islemler/aylik/intercompany-mutabakat":
          "Intercompany Reconciliation",
        "/app/donem-sonu-islemler/yillik": "Year-End Operations",
        "/app/donem-sonu-islemler/yillik/envanter-islemleri":
          "Inventory Transactions",
        "/app/donem-sonu-islemler/yillik/kapanis-islemleri":
          "Closing Transactions",
        "/app/donem-sonu-islemler/yillik/yerel-kapanis-paketleri":
          "Local Close Packs",
        "/app/donem-sonu-islemler/yillik/yansitma-islemleri":
          "Reflection Transactions",
        "/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari":
          "Consolidation Reports",
        "/app/raporlar": "Reports",
        "/app/defter-i-kebir": "General Ledger",
        "/app/muavin": "Subsidiary Ledger",
        "/app/cari-kontrol-mutabakati": "CARI Control Reconciliation",
        "/app/bilanco": "Balance Sheet",
        "/app/gelir-tablosu": "Income Statement",
        "/app/stok-raporu": "Stock Report",
        "/app/demirbas-raporu": "Fixed Asset Report",
        "/app/mizan-raporu": "Trial Balance Report",
        "/app/ayarlar": "Settings",
        "/app/ayarlar/security-admin": "User Management",
        "/app/ayarlar/security-admin?view=overview": "Overview",
        "/app/ayarlar/kullanicilar": "Users",
        "/app/ayarlar/security-admin/users": "Users and Assignments",
        "/app/ayarlar/security-admin/users?tab=users": "Users",
        "/app/ayarlar/security-admin/users?tab=people": "Users",
        "/app/ayarlar/security-admin/users?tab=assignments":
          "Assignments",
        "/app/ayarlar/security-admin/users?tab=scopes": "Scope Access",
        "/app/ayarlar/security-admin/users?tab=delegations":
          "Delegations",
        "/app/ayarlar/security-admin/users?tab=coverage":
          "Temporary Coverage",
        "/app/ayarlar/rbac/delegations": "Delegations",
        "/app/ayarlar/rbac/temporary-coverage": "Temporary Coverage",
        "/app/ayarlar/security-admin/users?tab=authority":
          "Users",
        "/app/ayarlar/roller-ve-yetkiler": "Roles and Permissions",
        "/app/ayarlar/security-admin/catalog": "Access Catalog",
        "/app/ayarlar/security-admin/catalog?tab=access-model":
          "Access Catalog",
        "/app/ayarlar/security-admin/catalog?tab=roles":
          "Roles and Permissions",
        "/app/ayarlar/security-admin/catalog?tab=field-visibility":
          "Field Visibility",
        "/app/ayarlar/security-admin/catalog?tab=group-ap-post":
          "Group AP Posting",
        "/app/ayarlar/security-admin/workflows": "Workflow Governance",
        "/app/ayarlar/security-admin/workflows?tab=definitions":
          "Workflow Governance",
        "/app/ayarlar/security-admin/workflows?tab=assignments":
          "Workflow Assignments",
        "/app/ayarlar/security-admin/workflows?tab=coverage":
          "Coverage",
        "/app/ayarlar/security-admin/workflows?tab=records":
          "Workflow Records",
        "/app/ayarlar/security-admin/workflows?tab=setup":
          "Workflow Setup",
        "/app/ayarlar/security-admin/diagnostics": "Diagnostics and Audit",
        "/app/ayarlar/security-admin/diagnostics?tab=access":
          "Access Explainability",
        "/app/ayarlar/security-admin/diagnostics?tab=compliance":
          "Compliance Reports",
        "/app/ayarlar/security-admin/diagnostics?tab=audit":
          "RBAC Audit Logs",
        "/app/ayarlar/security-admin/diagnostics?tab=raw-audit":
          "Raw Audit Logs",
        "/app/ayarlar/security-admin/diagnostics?tab=sensitive-data":
          "Sensitive Data Audit",
        "/app/ayarlar/delegasyonlarim": "My Delegations",
        "/app/ayarlar/sube-operatorleri": "Local User Administration",
        "/app/ayarlar/sirket-ayarlari": "Company Settings",
        "/app/ayarlar/organizasyon-yonetimi": "Organization Management",
        "/app/ayarlar/entity-aktivasyon-alani": "Entity Activation Workspace",
        "/app/ayarlar/hesap-plani-olustur": "Create Chart of Accounts",
        "/app/ayarlar/hesap-plani-ayarlari": "Chart of Accounts Settings",
        "/app/ayarlar/hesap-yeniden-siniflandirma":
          "GL Reclassification Workbench",
        "/app/ayarlar/kur-yonetimi": "FX Rate Management",
        "/app/ayarlar/vergi-kurulumu": "Tax Setup",
        "/app/ayarlar/konsolidasyon-kurulumu": "Consolidation Setup",
        "/app/ayarlar/stok-ayarlari": "Stock Settings",
        "/app/ayarlar/demirbas-ayarlari": "Fixed Asset Settings",
        "/app/ayarlar/demirbas-zimmetlileri": "Fixed Asset Custodians",
      },
    },
    cariSplit: {
      sections: {
        purchases: "Purchases",
        sales: "Sales",
      },
      pages: {
        vendorBills: "Vendor Bills",
        salesInvoices: "Sales Invoices",
        vendors: "Vendors",
        customers: "Customers",
        apPayments: "AP Payments",
        arReceipts: "AR Receipts",
        apBalances: "AP Balances",
        arBalances: "AR Balances",
      },
      actions: {
        newVendorBill: "New Vendor Bill",
        newSalesInvoice: "New Sales Invoice",
      },
      breadcrumbs: {
        purchases: "Purchases",
        sales: "Sales",
        vendorBills: "Vendor Bills",
        salesInvoices: "Sales Invoices",
        vendors: "Vendors",
        customers: "Customers",
        apPayments: "AP Payments",
        arReceipts: "AR Receipts",
        apBalances: "AP Balances",
        arBalances: "AR Balances",
      },
    },
    fixedAssets: {
      actions: {
        createAsset: "Create New Asset",
        activate: "Activate",
        suspend: "Suspend",
        reactivate: "Reactivate",
        physicalMove: "Physical Move",
        ownershipTransfer: "Ownership Transfer",
        writeoff: "Write Off",
        sale: "Sale",
        reverse: "Reverse",
        overrideAccounts: "Override Account Mappings",
      },
      permissions: {
        missingRead: "Missing permission: fixed_assets.read",
        missingUpsert: "Missing permission: fixed_assets.upsert",
        missingPost: "Missing permission: fixed_assets.post",
        missingDispose: "Missing permission: fixed_assets.dispose",
        missingTransfer: "Missing permission: fixed_assets.transfer",
        missingDepreciationRun:
          "Missing permission: fixed_assets.depreciation.run",
        missingReportRead: "Missing permission: fixed_assets.report.read",
        readOnlyNotice: "Read-only access — you do not have edit permissions.",
      },
      acquisitions: {
        title: "Fixed Asset Acquisitions",
        description:
          "Filtered view of acquisition and capitalization transactions.",
        noResults: "No acquisition or capitalization transactions found.",
        preferredFlowTitle: "Preferred Flow",
        preferredFlowNote:
          "The preferred acquisition flow is now the CARI FIXED_ASSET bill flow. Enter one vendor bill line with FIXED_ASSET and quantity, and let posting create the asset units automatically. Use the link-existing path only when a specific draft asset is already prepared.",
        expandGuidanceNote:
          "If units need different owner/location or serial metadata before posting, use 'Expand into individual asset lines'. If accounting or category differs, split them into separate CARI lines.",
        capitalizeFromAp: "Capitalize from AP Document",
        capitalizeDescription:
          "Create a new fixed asset from an eligible line on a posted CARI AP document.",
        fallbackTitle: "Legacy Fallback",
        fallbackDescription:
          "This section remains the fallback for AP bills that were already posted without a FIXED_ASSET line type. For new acquisitions, the preferred flow is the FIXED_ASSET line on the CARI form.",
        documentId: "Document ID",
        searchLines: "Search Lines",
        searching: "Searching...",
        eligibleLines: "Eligible AP Lines",
        noEligibleLines: "No eligible AP lines found for this document.",
        selectLine: "Select",
        selectedLine: "Selected Line",
        lineDescription: "Line Description",
        lineAmount: "Amount",
        lineCurrency: "Currency",
        lineAccount: "Account",
        clearSelection: "Clear Selection",
        assetDetails: "Asset Details",
        fieldUnitCount: "Unit Count",
        fieldCategory: "Category",
        fieldOwnerOu: "Owner Operating Unit",
        fieldLocationOu: "Location Operating Unit",
        fieldCapitalizationDate: "Capitalization Date",
        fieldInServiceDate: "In-Service Date",
        submit: "Create Asset",
        submitting: "Creating...",
        submitSuccess: "Asset created from CARI document.",
        submitFailed: "Failed to create asset.",
        documentIdRequired: "Document ID is required.",
        lineRequired: "You must select an AP line.",
        linkedFromCari: "Linked from CARI",
        cariCapitalization: "CARI Capitalization",
      },
      detail: {
        preferredSaleFlowTitle: "Preferred Sale Flow",
        preferredSaleFlowDescription:
          "For new sales, the preferred flow is to create a CARI AR draft with a FIXED_ASSET line targeting this asset.",
        preferredSaleFlowTargetLabel: "Target Asset",
        preferredSaleFlowStepOne:
          "The shortcut opens CARI Documents with an AR draft prefilled for this asset.",
        preferredSaleFlowStepTwo:
          "Choose Fixed Asset as the line type, target this asset, then enter the sale amount.",
        preferredSaleFlowStepThree:
          "Save and post the document; the sale and disposal flow completes in the same posting.",
        openCariSaleFlow: "Open Sale Invoice Draft",
        missingCariSalePermissions:
          "You need cari.doc.read and cari.doc.create permissions to open the preferred sale flow from this page.",
        legacySaleFallbackTitle: "Legacy Fallback",
        legacySaleFallbackDescription:
          "The older multi-step sale staging flow is not removed; it remains only as a fallback for already-staged or legacy cases. For new sales, the preferred flow is the CARI AR FIXED_ASSET document.",
        createLegacySaleFallbackDraft: "Create Legacy Sale Draft",
        creatingLegacySaleFallbackDraft: "Creating legacy sale draft...",
        openLegacySaleFallbackDraft: "Open legacy draft",
        legacySaleFallbackCreateSuccess:
          "Legacy sale fallback draft created. Finish the remaining editing and posting steps from the draft document.",
        legacySaleFallbackCounterpartyId: "Counterparty ID",
        legacySaleFallbackDocumentDate: "Document Date",
        legacySaleFallbackAmount: "Sale Amount",
        legacySaleFallbackHelper:
          "Use this fallback only for the older staged flow. Enter the counterparty and sale amount before creating the draft.",
        missingLegacySaleFallbackPermissions:
          "You need fixed_assets.dispose and cari.doc.create permissions to create a legacy fallback draft.",
        legacySaleFallbackMissingAsset:
          "A valid asset is required to create a legacy sale fallback draft.",
        legacySaleFallbackCounterpartyRequired: "Counterparty ID is required.",
        legacySaleFallbackDocumentDateRequired: "Document date is required.",
        legacySaleFallbackAmountRequired:
          "Sale amount must be a positive number.",
        legacySaleFallbackCreateFailed:
          "Failed to create legacy sale fallback draft.",
      },
      disposals: {
        title: "Fixed Asset Disposals",
        description: "Sale, write-off, and disposal transactions.",
        noResults: "No sale or disposal transactions found.",
      },
      reports: {
        title: "Fixed Asset Reports",
        selectReport: "Select Report",
        runReport: "Run Report",
        exportCsv: "Export CSV",
        exporting: "Exporting...",
        noResults: "No results found.",
        loading: "Loading...",
        filterLegalEntity: "Legal Entity",
        filterDateFrom: "Date From",
        filterDateTo: "Date To",
        filterCategory: "Category",
        filterOwnerOu: "Owner OU",
        filterLocationOu: "Location OU",
        filterCustodian: "Custodian",
        filterStatus: "Status",
        filterPeriodKey: "Period Key",
        register: "Asset Register",
        depreciationSchedule: "Depreciation Schedule",
        additions: "Additions (Acquisition / Capitalization)",
        disposals: "Disposals (Write-off / Sale)",
        transfers: "Ownership Transfers",
        byOwnerOu: "By Owner OU",
        byLocationOu: "By Location OU",
        byCustodian: "By Custodian",
        depreciationByOwnerOu: "Period Depreciation by Owner OU",
        rollforward: "Rollforward (Movement Table)",
        totalsLabel: "Totals",
        totalCount: "Total Count",
        totalCostBase: "Total Cost (Base)",
        acquisitionCount: "Acquisition Count",
        capitalizationCount: "Capitalization Count",
        writeoffCount: "Write-off Count",
        saleCount: "Sale Count",
        belowThreshold: "Below Threshold",
        lowValueFullExpense: "Low-Value Full Expense",
        openingNbv: "Opening NBV",
        closingNbv: "Closing NBV",
        totalDeprBase: "Total Depreciation (Base)",
      },
      createForm: {
        title: "Create Fixed Asset",
        backToRegister: "Back to register",
        sectionIdentity: "Identity and Description",
        sectionOrganization: "Organizational Assignment",
        sectionCost: "Cost and Currency",
        sectionDepreciation: "Depreciation Settings",
        sectionLegacy: "Legacy Onboarding",
        sectionAccounts: "Account Mapping Overrides",
        fieldName: "Asset Name",
        fieldDescription: "Description",
        fieldAssetTag: "Asset Tag",
        fieldSerialNo: "Serial No",
        fieldCategory: "Category",
        fieldLegalEntity: "Legal Entity",
        fieldOwnerOu: "Owner Operating Unit",
        fieldLocationOu: "Location Operating Unit",
        fieldDepartmentCode: "Department Code",
        fieldCostCenterCode: "Cost Center Code",
        fieldCustodian: "Custodian",
        fieldAcquisitionDate: "Acquisition Date",
        fieldCurrencyCode: "Currency",
        fieldOriginalCostTxn: "Original Cost (Txn)",
        fieldOriginalCostBase: "Original Cost (Base)",
        fieldDepreciationProfile: "Depreciation Profile",
        fieldUsefulLifeMonths: "Useful Life (months)",
        fieldSalvageRuleType: "Salvage Rule Type",
        fieldSalvagePercent: "Salvage Percent (%)",
        fieldSalvageAmountBase: "Salvage Amount (Base)",
        fieldRemainingUsefulLifeMonths: "Remaining Useful Life (months)",
        fieldLegacyAccumDeprTxn: "Legacy Accum Depreciation (Txn)",
        fieldLegacyAccumDeprBase: "Legacy Accum Depreciation (Base)",
        fieldLegacyNbvTxn: "Legacy NBV (Txn)",
        fieldLegacyNbvBase: "Legacy NBV (Base)",
        fieldInServiceDate: "In-Service Date",
        fieldPostingDate: "Posting Date",
        fieldCapitalizationDate: "Capitalization Date",
        fieldAssetAccount: "Asset Account",
        fieldAccumDeprAccount: "Accum Depreciation Account",
        fieldDeprExpenseAccount: "Depreciation Expense Account",
        fieldDisposalGainAccount: "Disposal Gain Account",
        fieldDisposalLossAccount: "Disposal Loss Account",
        saveDraft: "Save Draft",
        saving: "Saving...",
        activateAsset: "Activate",
        activating: "Activating...",
        lowValueNotice:
          "This asset is below the category capitalization threshold. It may be fully expensed on activation.",
        legacyNotice:
          "Fill legacy fields only for existing assets being migrated, leave blank for new acquisitions.",
        accountOverrideNotice:
          "Account override fields are only shown to users with fixed_assets.account_override permission.",
        validationRequired: "This field is required",
        validationPositiveNumber:
          "Enter a number greater than or equal to zero",
        createSuccess: "Asset draft created.",
        activateSuccess: "Asset activation successful.",
        createFailed: "Failed to create asset.",
        activateFailed: "Failed to activate asset.",
        categoryDefaults: "Category defaults applied to form.",
      },
    },
    opsDashboard: {
      title: "Ops Dashboard (H05)",
      filters: {
        legalEntityId: "Legal entity ID",
        bankAccountId: "Bank account ID",
        dateFrom: "Date from",
        dateTo: "Date to",
        daysFallback: "Days fallback",
        jobsModuleCode: "Jobs module code",
        jobsQueueName: "Jobs queue name",
      },
      placeholders: {
        optional: "optional",
        days: "30",
      },
      actions: {
        refresh: "Refresh",
        refreshing: "Refreshing...",
        exportUsageCsv: "Export Usage CSV",
        exportingUsage: "Exporting usage...",
        exportAuditCsv: "Export Audit CSV",
        exportingAudit: "Exporting audit...",
        openCashTransitQueue: "Open cash transit queue",
      },
      sections: {
        bankReconciliation: "Bank Reconciliation Summary",
        bankPayments: "Bank Payment Batches Health",
        cashTransit: "Cash Transit Queue",
        payrollImports: "Payroll Import Health",
        payrollClose: "Payroll Close Status",
        jobs: "Jobs Health",
      },
      cashTransit: {
        awaitingReceipt: "Awaiting receipt",
        pendingDispatch: "Pending dispatch",
        receivedInWindow: "Received in window",
        oldestWaitingHours: "Oldest waiting (hrs)",
        waitingAging: "Waiting aging",
        oldestWaitingTransfers: "Oldest waiting transfers",
        noIncomingWaiting: "No incoming transit transfers are waiting.",
        route: "Route",
        amount: "Amount",
        waitingSince: "Waiting since",
      },
      messages: {
        loadFailed: "Ops dashboard data could not be loaded",
        usageExportReady: "Usage CSV export downloaded: {{fileName}}",
        usageExportFailed: "Usage CSV export failed",
        auditExportReady: "Audit CSV export downloaded: {{fileName}}",
        auditExportFailed: "Audit CSV export failed",
        exportUnavailable: "Export is only available in browser sessions.",
      },
    },
    exceptionsWorkbench: {
      title: "Unified Exception Workbench (H06)",
      total: "Total: {{total}}",
      filters: {
        module: "Module",
        status: "Status",
        severity: "Severity",
        legalEntityId: "Legal entity ID",
        search: "Search",
        days: "Days",
        autoRefresh: "Auto-refresh sources on list",
        all: "All",
      },
      placeholders: {
        optional: "optional",
        search: "title/source/note",
        days: "180",
        resolutionNote: "Used by resolve/ignore/reopen actions",
      },
      actions: {
        loading: "Loading...",
        applyFilters: "Apply Filters",
        manualRefresh: "Manual Refresh",
        refreshing: "Refreshing...",
        details: "Details",
        claim: "Claim",
        resolve: "Resolve",
        ignore: "Ignore",
        reopen: "Reopen",
      },
      bulk: {
        selectVisible: "Select visible",
        selectedCount: "Selected: {{count}}",
        clearSelection: "Clear",
        claimSelected: "Claim Selected",
        resolveSelected: "Resolve Selected",
        ignoreSelected: "Ignore Selected",
        reopenSelected: "Reopen Selected",
        selectRow: "Select exception row",
        select: "Select",
      },
      summary: {
        byStatus: "By Status",
        byModule: "By Module",
        bySeverity: "By Severity",
      },
      sections: {
        exceptions: "Exceptions",
        resolutionNote: "Resolution Note",
        selectedException: "Selected Exception",
        auditTrail: "Audit Trail",
      },
      labels: {
        lastSeen: "last seen:",
        source: "source:",
      },
      messages: {
        loadFailed: "Exception workbench could not be loaded",
        detailLoadFailed: "Exception detail could not be loaded",
        workbenchRefreshed: "Workbench refreshed.",
        refreshFailed: "Refresh failed",
        actionApplied: "Action {{action}} applied.",
        actionFailed: "Action {{action}} failed",
        bulkActionApplied:
          "Bulk action {{action}} applied to {{count}} exceptions.",
        bulkActionPartial:
          "Bulk action {{action}} finished with partial success ({{succeeded}}/{{total}} succeeded, {{failed}} failed).",
        bulkActionFailed: "Bulk action {{action}} failed.",
        missingReadPermission: "Missing permission:",
        empty: "No exceptions found for current filters.",
        selectRow: "Select an exception row and click Details.",
        noAudit: "No audit entries.",
      },
    },
    retentionAdmin: {
      title: "Retention and Export Snapshots",
      subtitle:
        "PR-H07: policy-driven retention runs and immutable closed-period snapshot hashes.",
      sections: {
        policies: "Retention Policies",
        runs: "Retention Runs",
        snapshots: "Period Export Snapshots",
      },
      placeholders: {
        policyCode: "Policy Code",
        policyName: "Policy Name",
        retentionDays: "Retention Days",
        legalEntityOptional: "Legal Entity ID (optional)",
        leId: "LE ID",
        dataset: "Dataset",
        status: "Status",
        search: "Search",
        policyId: "Policy ID",
        payrollCloseId: "Payroll Close ID",
        idempotencyKeyOptional: "Idempotency key (optional)",
      },
      actions: {
        creating: "Creating...",
        loading: "Loading...",
        createPolicy: "Create Policy",
        refreshPolicies: "Refresh Policies",
        updating: "Updating...",
        toggleStatus: "Toggle Status",
        runSync: "Run Sync",
        queueAsync: "Queue Async",
        refreshRuns: "Refresh Runs",
        view: "View",
        createSnapshot: "Create Snapshot",
        refreshSnapshots: "Refresh Snapshots",
      },
      totals: {
        policies: "Total policies: {{total}}",
        runs: "Total runs: {{total}}",
        snapshots: "Total snapshots: {{total}}",
      },
      table: {
        code: "Code",
        datasetAction: "Dataset/Action",
        le: "LE",
        days: "Days",
        status: "Status",
        lastRun: "Last Run",
        actions: "Actions",
        run: "Run",
        policy: "Policy",
        counts: "Counts",
        startedFinished: "Started/Finished",
        detail: "Detail",
        snapshot: "Snapshot",
        lePeriod: "LE / Period",
        closeId: "Close ID",
        hash: "Hash",
      },
      labels: {
        tenant: "TENANT",
        scanned: "scanned:",
        affected: "affected:",
        maskedPurgedArchived: "masked/purged/archived:",
        le: "LE:",
      },
      messages: {
        missingPermissions: "Missing permissions:",
        andOr: "and/or",
        policiesLoadFailed: "Retention policies could not be loaded",
        runsLoadFailed: "Retention runs could not be loaded",
        snapshotsLoadFailed: "Export snapshots could not be loaded",
        policyCreated: "Retention policy created.",
        policyCreateFailed: "Retention policy could not be created",
        policyStatusUpdated: "Policy {{code}} status updated to {{status}}.",
        policyStatusUpdateFailed: "Policy status could not be updated",
        runQueued: "Retention run queued as job #{{id}}.",
        runCompleted: "Retention run completed (#{{id}}).",
        runFailed: "Retention run failed",
        runDetailLoadFailed: "Retention run detail could not be loaded",
        snapshotExists: "Snapshot already exists (#{{id}}).",
        snapshotCreated: "Snapshot created (#{{id}}).",
        snapshotCreateFailed: "Export snapshot could not be created",
        snapshotDetailLoadFailed: "Snapshot detail could not be loaded",
      },
    },
    intercompanyReconciliation: {
      title: "Intercompany Reconciliation",
      subtitle:
        "Compare intercompany activity by legal-entity pair and surface mismatches.",
      loadingLookups: "Loading lookup options...",
      missingPermission: "Missing permission: intercompany.reconcile.run",
      fiscalPeriodRequired: "fiscalPeriodId is required.",
      toleranceInvalid: "tolerance must be a non-negative number.",
      runFailed: "Failed to run reconciliation.",
      runSuccess: "Reconciliation completed. Pair count: {{count}}.",
      calendarLabel: "Fiscal calendar",
      calendarPlaceholder: "Select fiscal calendar",
      calendarIdPlaceholder: "Fiscal calendar ID",
      periodLabel: "Fiscal period",
      periodPlaceholder: "Select fiscal period",
      periodIdPlaceholder: "Fiscal period ID",
      fromEntityLabel: "From legal entity",
      fromEntityPlaceholder: "All source legal entities",
      fromEntityIdPlaceholder: "From legal entity ID (optional)",
      toEntityLabel: "To legal entity",
      toEntityPlaceholder: "All counterparty legal entities",
      toEntityIdPlaceholder: "To legal entity ID (optional)",
      toleranceLabel: "Tolerance",
      includeMatched: "Include matched pairs",
      includeAccountBreakdown: "Include account breakdown",
      runButton: "Run Reconciliation",
      runningButton: "Reconciling...",
      summary:
        "Pairs: {{pairCount}} | Matched: {{matchedPairCount}} | Mismatched: {{mismatchedPairCount}} | Unilateral: {{unilateralPairCount}} | Total abs diff: {{total}}",
      table: {
        pair: "Pair",
        status: "Status",
        abNet: "A->B Net",
        baNet: "B->A Net",
        difference: "Difference",
        empty: "No reconciliation rows. Select filters and run reconciliation.",
      },
    },
    consolidationReports: {
      title: "Consolidation Reports",
      subtitle:
        "View consolidated balance sheet/income statement and post draft eliminations or adjustments.",
      missingPermissionRun: "Missing permission: consolidation.run.read",
      missingPermissionBs:
        "Missing permission: consolidation.report.balance_sheet.read",
      missingPermissionIs:
        "Missing permission: consolidation.report.income_statement.read",
      missingPermissionAdj: "Missing permission: consolidation.adjustment.post",
      missingPermissionElim:
        "Missing permission: consolidation.elimination.post",
      runRequired: "consolidation runId is required.",
      loadRunsFailed: "Failed to load consolidation runs.",
      loadBsFailed: "Failed to load balance sheet.",
      loadIsFailed: "Failed to load income statement.",
      loadWorklistFailed: "Failed to load consolidation worklist.",
      postAdjFailed: "Failed to post adjustment.",
      postElimFailed: "Failed to post elimination entry.",
      loadBsSuccess: "Consolidated balance sheet loaded.",
      loadIsSuccess: "Consolidated income statement loaded.",
      loadWorklistSuccess: "Consolidation draft/posting worklist loaded.",
      postAdjSuccess: "Adjustment #{{id}} posted.",
      postElimSuccess: "Elimination entry #{{id}} posted.",
      runLabel: "Consolidation run",
      runPlaceholder: "Select consolidation run",
      runIdPlaceholder: "Consolidation run ID",
      rateTypeLabel: "Rate type",
      includeDraft: "Include draft adjustments/eliminations",
      includeZero: "Include zero-balance rows",
      loadBsButton: "Load Balance Sheet",
      loadBsLoading: "Loading BS...",
      loadIsButton: "Load Income Statement",
      loadIsLoading: "Loading IS...",
      loadWorklistButton: "Load Draft Worklist",
      loadWorklistLoading: "Loading...",
      refreshRunsButton: "Refresh Runs",
      refreshRunsLoading: "Refreshing...",
      selectedRunSummary:
        "Run #{{id}} | Group: {{groupCode}} - {{groupName}} | Period: {{fiscalYear}}-P{{periodNo}} ({{periodName}}) | Status: {{status}}",
      workflow: {
        title: "Workflow approval gate status",
        openSetup: "Open workflow governance",
        loading: "Loading workflow gate status...",
        loadFailed: "Failed to load workflow gate status.",
        summary:
          "Status: {{status}} | Current step: {{step}} | Definition: {{definitionCode}}",
        none: "No workflow instance exists for this run yet. Finalize will create/check it when gate is enabled.",
        missingPermission:
          "Missing permission: org.tree.read (required to view workflow gate details).",
      },
      bsTotals:
        "BS Assets: {{assets}} | Liabilities: {{liabilities}} | Equity: {{equity}} | Current Earnings: {{earnings}} | Delta: {{delta}}",
      isTotals:
        "IS Revenue: {{revenue}} | Expense: {{expense}} | Net income: {{net}}",
      tables: {
        bsTitle: "Balance Sheet rows",
        isTitle: "Income Statement rows",
        account: "Account",
        type: "Type",
        normalized: "Normalized",
        bsEmpty:
          "No balance-sheet rows loaded. Select a run and click Load Balance Sheet.",
        isEmpty:
          "No income-statement rows loaded. Select a run and click Load Income Statement.",
        adjustmentsTitle: "Adjustment Worklist",
        eliminationsTitle: "Elimination Worklist",
        id: "ID",
        status: "Status",
        description: "Description",
        debit: "Debit",
        credit: "Credit",
        lines: "Lines",
        action: "Action",
        post: "Post",
        posting: "Posting...",
        none: "-",
        adjustmentsEmpty:
          "No adjustment rows loaded. Load draft worklist or create new adjustments.",
        eliminationsEmpty:
          "No elimination rows loaded. Load draft worklist or create new eliminations.",
      },
    },
    userAssignments: {
      title: "User Assignment Management",
      subtitle: "Assign roles to users with scoped access.",
      loadFailed: "Failed to load assignment data",
      missingPermission: "Missing permission: security.role_assignment.upsert",
      scopeInvalid: "scopeId must be a positive integer.",
      userCreateSuccess: "Invite created.",
      userCreateFailed: "Failed to create invite.",
      saveFailed: "Failed to save role assignment",
      saveSuccess: "Role assignment saved.",
      deleteConfirm: "Delete this role assignment?",
      deleteFailed: "Failed to delete assignment",
      deleteSuccess: "Assignment deleted.",
      createUser: {
        title: "Invite User (Copy Link)",
        name: "Full Name",
        email: "Email",
        submit: "Create Invite",
        submitting: "Creating invite...",
        inviteLinkReady: "Invite link ready:",
        copyInviteLink: "Copy Invite Link",
        inviteCopied: "Invite link copied.",
        inviteCopyFailed: "Failed to copy invite link.",
      },
      placeholders: {
        user: "Select user",
        role: "Select role",
        scope: "Select scope",
        scopeId: "Scope ID",
      },
      actions: {
        assign: "Assign",
        assigning: "Saving...",
        delete: "Delete",
      },
      list: {
        title: "Current Role Assignments",
        loading: "Loading assignments...",
        empty: "No assignments found.",
        user: "User",
        role: "Role",
        scope: "Scope",
        effect: "Effect",
        action: "Action",
      },
    },
    branchOperators: {
      title: "Local User Administration",
      subtitle:
        "Invite, assign, and revoke allow-listed local roles inside the legal entities and operating units you manage.",
      loadFailed: "Failed to load local user administration data.",
      saveFailed: "Failed to save local role assignment.",
      deleteFailed: "Failed to remove local role assignment.",
      deleteConfirm: "Delete this local role assignment?",
      missingPermission: "Missing permission for local user administration.",
      noOperatingUnits:
        "No manageable legal entities or operating units were found.",
      noRoles: "No allow-listed local roles are configured for this tenant.",
      form: {
        title: "Invite Local User",
        subtitle:
          "Invite a new user or assign an existing tenant user to the selected local role and scope.",
        name: "Full Name",
        email: "Email",
        selectRole: "Select role",
        roleRequired: "Role selection is required.",
        selectScopeType: "Select scope type",
        scopeTypeLegalEntity: "Legal entity scope",
        scopeTypeOperatingUnit: "Operating unit scope",
        selectLegalEntity: "Select legal entity",
        legalEntityRequired: "Legal entity selection is required.",
        selectOperatingUnit: "Select operating unit",
        submit: "Assign Local Role",
        submitting: "Saving...",
        operatingUnitRequired: "Operating unit selection is required.",
        roleCount: "Manageable roles: {{count}}",
        entityCount: "Visible legal entities: {{count}}",
      },
      messages: {
        inviteCreated: "Invite and local role assignment are ready.",
        assignmentCreated: "Local role assignment saved.",
        assignmentExists:
          "This user is already assigned for the selected scope.",
        assignmentRemoved: "Local role assignment removed.",
        inviteLinkReady: "Invite link ready:",
        copyInviteLink: "Copy Invite Link",
        inviteCopied: "Invite link copied.",
        inviteCopyFailed: "Failed to copy invite link.",
      },
      actions: {
        delete: "Delete",
      },
      list: {
        title: "Current Local Role Assignments",
        loading: "Loading local role assignments...",
        empty: "No local role assignments found.",
        user: "User",
        role: "Role",
        scope: "Scope",
        status: "Status",
        action: "Action",
        userStatus: "User:",
        scopeStatus: "Scope:",
      },
    },
    scopeAssignments: {
      title: "Scope Assignment Management",
      subtitle:
        "Replace user data scopes and replace existing assignment scopes.",
      loadLookupsFailed: "Failed to load scope lookups",
      loadUserScopeFailed: "Failed to load user scope data",
      missingDataScopePermission:
        "Missing permission: security.data_scope.upsert",
      missingAssignmentPermission:
        "Missing permission: security.role_assignment.upsert",
      scopeRequired: "Scope ID is required.",
      replaceScopesFailed: "Failed to replace user data scopes",
      replaceScopesSuccess: "User data scopes replaced.",
      replaceAssignmentFailed: "Failed to replace assignment scope",
      replaceAssignmentSuccess: "Role assignment scope replaced.",
      userLabel: "User",
      userPlaceholder: "Select user",
      dataScopesTitle: "Data Scopes",
      assignmentTitle: "Replace Existing Role Assignment Scope",
      selectScope: "Select scope",
      selectAssignment: "Select assignment",
      addScope: "Add Scope",
      removeScope: "Remove",
      replaceScopesButton: "Replace User Data Scopes",
      replaceAssignmentButton: "Replace",
      saving: "Saving...",
      loading: "Loading users and scope lookups...",
      emptyScopes: "No scopes configured for this user.",
      columns: {
        scopeType: "Scope Type",
        scopeId: "Scope ID",
        effect: "Effect",
        action: "Action",
      },
    },
    rolesPermissions: {
      title: "Roles & Permissions Management",
      subtitle:
        "Create roles and manage explicit permission assignments per role.",
      errors: {
        loadFailed: "Failed to load roles and permissions",
        missingUpsertPermission: "Missing permission: security.role.upsert",
        missingAssignPermission:
          "Missing permission: security.role_permissions.assign",
        saveRoleFailed: "Failed to save role",
        replacePermissionsFailed: "Failed to replace permissions",
      },
      messages: {
        roleSaved: "Role created or updated.",
        permissionsReplaced: "Role permissions replaced.",
      },
      placeholders: {
        roleCode: "Role code (e.g. FinanceReadOnly)",
        roleName: "Role name",
      },
      actions: {
        saving: "Saving...",
        saveRole: "Save Role",
        replacePermissions: "Replace Permissions",
      },
      sections: {
        roles: "Roles",
        loadingRoles: "Loading roles...",
        permissions: "Permissions",
        permissionsFor: "Permissions for {{code}}",
        loadingPermissions: "Loading permissions...",
      },
    },
    rbacAuditLogs: {
      title: "RBAC Audit Logs",
      subtitle: "Review role/permission/scope administration audit trail.",
      errors: {
        loadFailed: "Failed to load RBAC audit logs",
      },
      filters: {
        allScopeTypes: "All scope types",
        scopeId: "Scope ID",
        action: "Action (e.g. role.create)",
        resourceType: "Resource type",
        apply: "Apply Filters",
      },
      recordsTitle: "Audit Log Records",
      loading: "Loading logs...",
      empty: "No logs found.",
      columns: {
        time: "Time",
        action: "Action",
        resource: "Resource",
        actor: "Actor",
        target: "Target",
        scope: "Scope",
        payload: "Payload",
      },
      pagination: {
        summary: "Page {{page}} of {{totalPages}} | Total records: {{total}}",
        previous: "Previous",
        next: "Next",
      },
    },
    rawAuditLogs: {
      title: "Raw Audit Logs",
      subtitle:
        "Review the system audit_logs table in a readable format, including action, resource, request ID, and payload details.",
      errors: {
        loadFailed: "Failed to load raw audit logs.",
      },
      filters: {
        allScopeTypes: "All scope types",
        scopeId: "Scope ID",
        userId: "User ID",
        action: "Search action",
        resourceType: "Search resource type",
        resourceId: "Search resource ID",
        requestId: "Search request ID",
        apply: "Apply Filters",
        reset: "Reset",
      },
      recordsTitle: "Raw Audit Records",
      loading: "Loading raw audit logs...",
      empty: "No raw audit logs found.",
      columns: {
        time: "Time",
        action: "Action",
        resource: "Resource",
        user: "User",
        scope: "Scope",
        requestId: "Request ID",
        details: "Details",
        ipAddress: "IP address",
        userAgent: "User agent",
      },
      actions: {
        viewDetails: "View details",
      },
      pagination: {
        summary: "Page {{page}} of {{totalPages}} | Total records: {{total}}",
        previous: "Previous",
        next: "Next",
      },
    },
    accessDebugger: {
      loading: "Loading access chain...",
      empty: "Run a check to inspect the layered access chain.",
      labels: {
        yes: "Yes",
        no: "No",
      },
      actions: {
        whyCantIDoThis: "Why can't I do this?",
        explainAccess: "Explain Access",
        run: "Run Access Check",
        running: "Checking access...",
        reset: "Reset",
        close: "Close",
      },
      modal: {
        title: "Why can't I do this?",
        subtitle:
          "Review permission, scope, visibility, and governance layers for this action.",
      },
      page: {
        title: "Access Diagnostics",
        subtitle:
          "Explain one user's effective authority at the selected workflow family and target scope, then drill into the lower-level access chain from the same page.",
        noteTitle: "Admin view",
        noteBody:
          "This panel can inspect another user's effective authority and lower-level access chain. Cross-user checks are still enforced by the backend SecurityAdmin gate.",
      },
      form: {
        userPlaceholder: "Select user",
        permissionPlaceholder: "Permission code (e.g. payments.batch.approve)",
        noScope: "No scope",
        scopePlaceholder: "Select scope",
        scopeId: "Scope ID",
        advanced: "Advanced context",
        moduleCode: "Module code",
        objectType: "Object type",
        fieldName: "Field name",
        workflowRequestId: "Workflow request ID",
        actionCode: "Action code",
        recordType: "Record type",
        recordId: "Record ID",
      },
      errors: {
        loadLookupsFailed: "Failed to load users or scope lookups.",
        targetUserRequired: "A target user is required.",
        runFailed: "Failed to run the access check.",
      },
      summary: {
        allowed: "Access allowed",
        denied: "Access blocked",
        selfCheck: "This result reflects the user's own access chain.",
        adminCheck:
          "This result was run by an admin against the target user's access chain.",
        permission: "Permission",
        scope: "Requested scope",
        targetUser: "Target user",
        visibilityNarrowed: "Visibility narrowed",
        maskedFields: "Masked fields",
        recommendations: "Recommended next steps",
        layers: "Layer results",
        technicalDetails: "Technical details",
        notProvided: "Not provided",
      },
      layers: {
        capability: "Capability",
        scopeEntitlement: "Scope entitlement",
        visibilityPolicy: "Visibility policy",
        sod: "SoD",
        workflow: "Workflow",
        businessState: "Business state",
        fieldVisibility: "Field visibility",
      },
      recommendations: {
        missingPermission:
          "Ask a Security Admin to assign {{permission}} if this action should be available.",
        scopeDenied:
          "Assign the permission at {{scopeType}} #{{scopeId}} or choose a scope the user already holds.",
        visibilityDenied:
          "Review the user's data-scope visibility. The action scope exists, but row visibility is narrower.",
        fieldVisibility:
          "Grant the scoped override {{permission}} if this field should be fully visible.",
        sod: "Use a different reviewer or operator on this record to satisfy segregation-of-duties rules.",
        workflow:
          "Complete the required workflow approval step before retrying this action.",
        businessState:
          "Resolve the blocking business-state condition on the record before retrying.",
        visibilityNarrowed:
          "Some records may still stay hidden because data visibility is narrowed to assigned scopes.",
      },
    },
    cashControlMode: {
      title: "Cash control mode: {{mode}}",
      modes: {
        OFF: "OFF",
        WARN: "WARN",
        ENFORCE: "ENFORCE",
      },
      descriptions: {
        OFF: "Direct GL posting checks for cash-control are disabled.",
        WARN: "Direct GL posting is allowed, but cash-control warnings are logged.",
        ENFORCE:
          "Direct GL posting to cash-controlled accounts is blocked unless source is CASH or override is used.",
      },
      unavailable: "Cash control mode is currently unavailable.",
      requestId: "Request ID: {{requestId}}",
    },
    cashRegisters: {
      title: "Cash Registers",
      subtitle:
        "List cash registers, create and update register definitions, and manage active/inactive status.",
      readOnlyNotice:
        "You are in read-only mode. cash.register.upsert permission is required for edit actions.",
      loading: "Loading cash registers...",
      empty: "No cash registers found.",
      sections: {
        create: "Create Cash Register",
        edit: "Edit Cash Register",
        list: "Cash Register List",
      },
      actions: {
        create: "Save",
        update: "Update",
        edit: "Edit",
        cancelEdit: "Cancel Edit",
        quickSetup: "Quick Setup",
        closeQuickSetup: "Close Quick Setup",
        runQuickSetup: "Create Selected",
        quickSetupSaving: "Running quick setup...",
        selectPreferredCurrency: "Select preferred",
        selectAll: "Select all",
        clearSelection: "Clear selection",
        activate: "Activate",
        deactivate: "Deactivate",
        refresh: "Refresh",
        loading: "Loading...",
        saving: "Saving...",
      },
      form: {
        code: "Code",
        name: "Name",
        legalEntityId: "Legal entity ID",
        ownershipScope: "Ownership",
        ownershipCentralHelp:
          "Central registers stay in central context and do not carry an operating-unit dimension.",
        ownershipOperatingUnitHelp:
          "Operating-unit registers belong to the selected branch and run in branch context.",
        operatingUnitIdOptional: "Operating unit ID (optional)",
        operatingUnitIdRequired: "Operating unit ID (required)",
        operatingUnitHiddenForCentral:
          "Operating unit selection is not used for Central ownership.",
        accountId: "Account ID",
        currencyCode: "Currency code (USD)",
        allowNegative: "Allow negative balance",
        varianceGainAccountIdOptional: "Variance gain account ID (optional)",
        varianceLossAccountIdOptional: "Variance loss account ID (optional)",
        maxTxnAmountOptional: "Max transaction amount (optional)",
        requiresApprovalOverAmountOptional:
          "Requires approval over amount (optional)",
      },
      placeholders: {
        legalEntity: "Select legal entity",
        sessionMode: "Select session mode",
        operatingUnit: "Select operating unit",
        account: "Select account",
        currencyCode: "Select currency",
        varianceGainAccount: "Select variance gain account (optional)",
        varianceLossAccount: "Select variance loss account (optional)",
      },
      accountPicker: {
        searchPlaceholder: "Search account code/name",
        selectLegalEntityFirst: "Select legal entity first",
        noOptions: "No accounts found.",
        searchHelp:
          "Search by code or name. If a code is missing, create its child account directly here.",
        codeNotFoundHint:
          "Code {{code}} was not found. You can create a new child account under a parent.",
        parentPlaceholder: "Select parent account",
        parentNoOptions: "No parent accounts found.",
        childCodePlaceholder: "New child account code",
        childNamePlaceholder: "New child account name",
        useTypedCode: "Use typed code",
        useNextCode: "Use next child code",
        createChild: "Create child and select",
        creatingChild: "Creating child account...",
        missingUpsertPermissionHint:
          "gl.account.upsert permission is required to create child accounts.",
      },
      quickSetup: {
        title: "Quick Cash Setup",
        description:
          "Use the current legal entity / ownership selection to create child cash accounts and register definitions for the selected currencies.",
        selectedCount: "{{count}} currencies selected",
        scopeLabel: "Scope",
        scopeMissing: "Complete the scope selection first.",
        defaultsLabel: "Defaults Used",
        defaultsHelp:
          "Register type: {{registerType}} | session mode: {{sessionMode}} | status: {{status}}",
        operatingUnitLabel: "Operating unit / branch",
        operatingUnitHelp:
          "When ownership is Operating Unit, choose the branch here for which quick setup should create registers.",
        noOperatingUnits:
          "No operating units exist for the selected legal entity. Create the branch / OU first in Organization Management.",
        parentAccountLabel: "Parent cash account",
        parentAccountPlaceholder:
          "Select the parent account for new child accounts",
        parentAccountHelp:
          "Quick setup opens one postable child account per currency under this parent and links the register to that account.",
        currencyLabel: "Currencies",
        blockerLegalEntity: "select legal entity",
        blockerOperatingUnit: "select operating unit",
        blockerParentAccount: "select parent account",
        blockerCurrency: "select at least one currency",
        blockedBy: "Button disabled: {{reasons}}",
        readyHint:
          "Ready. The selected currencies will create child accounts and cash registers.",
      },
      table: {
        code: "Code",
        name: "Name",
        ownership: "Ownership",
        registerType: "Register Type",
        sessionMode: "Session Mode",
        legalEntity: "Legal Entity",
        operatingUnit: "Operating Unit",
        account: "Account",
        currency: "Currency",
        allowNegative: "Allow Negative",
        status: "Status",
        actions: "Actions",
      },
      values: {
        yes: "Yes",
        no: "No",
        ownershipCentral: "Central",
        ownershipOperatingUnit: "Operating Unit",
        centralHq: "Central",
      },
      errors: {
        missingReadPermission:
          "cash.register.read permission is required to use this page.",
        missingUpsertPermission:
          "cash.register.upsert permission is required for this action.",
        missingAccountUpsertPermission:
          "gl.account.upsert permission is required to create child accounts.",
        loadRegisters: "Failed to load cash registers.",
        loadOrgLookups:
          "Failed to load organization lookups. Fill IDs manually if needed.",
        loadAccountLookups:
          "Failed to load account lookups. Fill account IDs manually if needed.",
        missingOrgLookupPermission:
          "Without org.tree.read permission, legal entity/operating unit/currency lookup lists cannot be loaded.",
        missingAccountLookupPermission:
          "Without gl.account.read permission, account lookup lists cannot be loaded.",
        requiredCodeName: "Code and name are required.",
        requiredSessionMode: "sessionMode is required.",
        requiredEntityAccount: "legalEntityId and accountId are required.",
        requiredCurrency: "currencyCode is required.",
        operatingUnitRequiredForOwnership:
          "operatingUnitId is required when Ownership is Operating Unit.",
        invalidAmount: "An invalid numeric value exists in amount fields.",
        parentAccountRequired:
          "Select a parent account to create a child account.",
        childAccountCodeRequired: "Child account code is required.",
        childAccountNameRequired: "Child account name is required.",
        childAccountCodeParentConflict:
          "Child account code cannot be the same as the parent account code.",
        childAccountParentCoaMissing:
          "coaId could not be resolved for selected parent.",
        createChildAccount: "Failed to create child account.",
        quickSetupRequiresAccountLookup:
          "Quick setup requires both gl.account.read and gl.account.upsert permissions.",
        quickSetupParentMustBeAsset:
          "Quick setup parent account must be an active ASSET account.",
        quickSetupParentAlreadyRegister:
          "The selected parent account is already linked to a cash register. Creating children under it would break that register.",
        quickSetupCurrencyRequired:
          "Select at least one currency for quick setup.",
        quickSetupNoChildCode:
          "Unable to allocate a new child account code under the selected parent.",
        quickSetupFailed: "Quick setup failed.",
        save: "Failed to save cash register.",
        statusUpdate: "Failed to update cash register status.",
      },
      messages: {
        created: "Cash register created.",
        updated: "Cash register updated.",
        statusUpdated: "Cash register {{code}} status updated to {{status}}.",
        accountExistsSelected:
          "{{code}} already exists. Existing account selected.",
        childAccountCreatedAndSelected:
          "Child account {{code}} created under {{parentCode}} and selected.",
        quickSetupCompleted:
          "Quick setup completed. {{createdCount}} registers created, {{existingCount}} existing registers skipped, {{accountCount}} child accounts created.",
        quickSetupPartial:
          "Quick setup partially completed. {{createdCount}} registers created, {{existingCount}} existing registers skipped, {{accountCount}} child accounts created, {{failedCount}} currencies failed.",
      },
    },
    cashSessions: {
      title: "Cash Sessions",
      subtitle:
        "Open and close cash sessions, monitor open sessions, and review session history.",
      loading: "Loading cash sessions...",
      emptyOpen: "No open cash sessions found.",
      emptyHistory: "No cash session history found.",
      readOnlyOpenNotice:
        "cash.session.open permission is required to open sessions.",
      readOnlyCloseNotice:
        "cash.session.close permission is required to close sessions.",
      approvalNotice:
        "cash.variance.approve permission is required to approve over-threshold variance.",
      forcedCloseNotice:
        "closeNote is required when closedReason is FORCED_CLOSE.",
      sections: {
        open: "Open Session",
        close: "Close Session",
        openSessions: "Open Sessions",
        history: "Session History",
        lifecycle: "Session Lifecycle",
      },
      actions: {
        open: "Open Session",
        close: "Close Session",
        refresh: "Refresh",
        loading: "Loading...",
        saving: "Saving...",
        useForClose: "Use For Close",
        inspectLifecycle: "Lifecycle",
      },
      form: {
        openingAmountOptional: "Opening amount (optional, defaults to 0)",
        countedClosingAmount: "Counted closing amount",
        closeNote:
          "Close note (required for FORCED_CLOSE / threshold variance)",
        approveVariance:
          "Approve over-threshold variance (approveVariance=true)",
      },
      placeholders: {
        register: "Select cash register",
        openSession: "Select open session",
      },
      table: {
        register: "Register",
        status: "Status",
        openedAt: "Opened At",
        closedAt: "Closed At",
        opening: "Opening",
        expected: "Expected",
        counted: "Counted",
        variance: "Variance",
        closedReason: "Closed Reason",
        approvedBy: "Approved By",
        approvedAt: "Approved At",
        actions: "Actions",
      },
      values: {
        statusOpen: "Open",
        statusClosed: "Closed",
      },
      lifecycle: {
        snapshotTitle: "Lifecycle Snapshot",
        selectedSummary:
          "Selected session #{{id}} | Register: {{registerCode}} | Status: {{status}}",
        nextTransitions: "Next allowed transitions: {{actions}}",
        noTransitions:
          "No further lifecycle transitions are defined from this status.",
        noSelection: "Select a session to inspect lifecycle details.",
        timelineTitle: "Session Lifecycle Timeline",
        timelineEmpty: "No lifecycle history available for this session yet.",
        actionLabels: {
          close: "Close Session",
        },
      },
      requiredWarning: {
        title: "Session mode REQUIRED but no open session",
        description:
          "Active registers below do not have an open session. Transaction create/post flows may be blocked.",
      },
      selectedSessionSummary:
        "Selected session #{{id}} | Register: {{registerCode}} | Opening: {{opening}} | Expected: {{expected}}",
      errors: {
        missingReadPermission:
          "cash.register.read permission is required to use this page.",
        missingOpenPermission:
          "cash.session.open permission is required for this action.",
        missingClosePermission:
          "cash.session.close permission is required for this action.",
        missingVarianceApprovePermission:
          "cash.variance.approve permission is required for this action.",
        load: "Failed to load cash sessions.",
        open: "Failed to open cash session.",
        close: "Failed to close cash session.",
        requestId: "Request ID: {{requestId}}",
        registerRequired: "registerId is required.",
        invalidOpeningAmount: "Opening amount is invalid.",
        sessionRequired: "sessionId is required.",
        countedRequired: "countedClosingAmount is required.",
        closeNoteForced: "closeNote is required for FORCED_CLOSE.",
        closeNoteApproval: "closeNote is required when approveVariance=true.",
      },
      errorsMapped: {
        registerNotFound: "Selected register was not found.",
        sessionAlreadyOpen: "An OPEN session already exists for this register.",
        sessionModeNone:
          "Session cannot be opened because register session_mode is NONE.",
        registerInactive: "Selected register is not ACTIVE.",
        sessionNotFound: "Selected session was not found.",
        onlyOpenClose: "Only OPEN sessions can be closed.",
        unpostedTransactionsExist:
          "Session cannot be closed while DRAFT/SUBMITTED/APPROVED transactions exist.",
        closeNoteThreshold:
          "closeNote is required when variance exceeds approval threshold.",
        varianceApprovalRequired:
          "Variance exceeds configured threshold; supervisor/finance approval is required.",
        varianceGainMissing:
          "varianceGainAccountId must be configured for over variance.",
        varianceLossMissing:
          "varianceLossAccountId must be configured for short variance.",
      },
      messages: {
        opened: "Cash session opened successfully.",
        closed: "Cash session closed successfully.",
      },
    },
    cashTransactions: {
      presetTitles: {
        all: "Cash Transactions",
        payout: "Payment Transactions",
        receipt: "Receipt Transactions",
      },
      subtitle:
        "Filter cash transactions, create new rows, and manage post/cancel/reverse workflows.",
      presetNotices: {
        payout: "Transaction type is fixed to PAYOUT on this route.",
        receipt: "Transaction type is fixed to RECEIPT on this route.",
      },
      loading: "Loading cash transactions...",
      empty: "No cash transactions found.",
      readOnlyNotice:
        "You are in read-only mode. cash.txn.create permission is required to create transactions.",
      sections: {
        filters: "Filters",
        create: "Create Cash Transaction",
        action: "Selected Transaction Action",
        lifecycle: "Transaction Lifecycle",
        list: "Cash Transaction List",
      },
      placeholders: {
        allRegisters: "All registers",
        allTypes: "All transaction types",
        allStatuses: "All statuses",
        register: "Select register",
        sessionSelectRegisterFirst: "Select register first",
        sessionOptional: "Session (optional)",
        sessionRequired: "Session (required)",
        sessionNotUsed: "Session not used (session_mode=NONE)",
        autoOrNone: "Auto / none",
        searchCounterparty: "Search counterparty code/name",
        searchAccount: "Search account code/name",
        searchBankAccount: "Search bank account / GL code",
        selectCounterparty: "Select counterparty",
        counterAccount: "Select counter account",
        bankCounterAccount: "Select bank account",
        counterRegister: "Select counter register",
      },
      form: {
        registerId: "registerId",
        registerIdManualFallback:
          "No register list available; enter register ID",
        sessionId: "sessionId",
        cashSessionIdOptional: "cashSessionId (optional)",
        cashSessionIdRequiredManualFallback:
          "Enter OPEN cashSessionId for selected register (required)",
        cashSessionIdSelectRegisterFirst: "Select register first",
        cashSessionIdNotUsed:
          "Selected register has session_mode=NONE; cashSessionId is not needed",
        cashSessionIdManualFallback:
          "If open session list is unavailable, enter cashSessionId (optional)",
        amount: "Amount",
        currencyCode: "Currency code (USD)",
        referenceNoOptional: "Reference no (optional)",
        sourceDocIdOptional: "Source document ID (optional)",
        sourceDocTypeOptional: "Source document type (optional)",
        counterpartyTypeOptional: "Counterparty type (optional)",
        counterpartyIdOptional: "Counterparty ID (optional)",
        counterpartyIdManualFallback: "Counterparty ID (manual)",
        counterAccountIdOptional: "counterAccountId (optional)",
        bankCounterAccountIdManualFallback: "Bank GL account ID (manual)",
        counterAccountIdManualFallback: "Counter account ID (manual)",
        counterCashRegisterIdOptional: "counterCashRegisterId (optional)",
        descriptionOptional: "Description (optional)",
        transitTransferId: "transitTransferId",
        bookDate: "bookDate",
        txnDatetime: "txnDatetime",
        idempotencyKey: "idempotencyKey",
        fxRateOptional: "fxRate (optional)",
        useUnappliedCash: "useUnappliedCash",
        noteOptional: "note (optional)",
        settlementDate: "settlementDate",
        asOfDateOpenDocs: "asOfDate (open docs)",
        overrideCashControl: "Post with cash-control override",
        overrideReason: "Override reason (required)",
        cancelReason: "Cancel reason (required)",
        reverseReason: "Reverse reason (required)",
      },
      actions: {
        applyFilters: "Apply Filters",
        clear: "Clear",
        clearFilters: "Clear",
        refresh: "Refresh",
        loading: "Loading...",
        openRegisterSetup: "Go to Cash Registers",
        openSessionSetup: "Go to Cash Sessions",
        openBankAccountSetup: "Go to Bank Accounts",
        fillAll: "Fill All",
        create: "Create Transaction",
        creating: "Creating...",
        preparePost: "Post",
        prepareCancel: "Cancel",
        prepareReverse: "Reverse",
        receiveTransit: "Receive Transit",
        applyCari: "Apply Cari",
        submitAction: "Apply Action",
        cancelAction: "Dismiss",
        inspectLifecycle: "Lifecycle",
        saving: "Saving...",
      },
      selectedTransactionSummary:
        "Selected transaction #{{id}} | No: {{txnNo}} | Status: {{status}}",
      lifecycle: {
        snapshotTitle: "Lifecycle Snapshot",
        nextTransitions: "Next allowed transitions: {{actions}}",
        noTransitions:
          "No further lifecycle transitions are defined from this status.",
        timelineTitle: "Transaction Lifecycle Timeline",
        timelineEmpty:
          "No lifecycle history available for this transaction yet.",
        actionLabels: {
          submit: "Submit",
          approve: "Approve",
          post: "Post",
          cancel: "Cancel",
          reverse: "Reverse",
        },
        events: {
          draft: "Draft created.",
          submitted: "Submitted for approval.",
          approved: "Approved for posting.",
          posted: "Posted to ledger.",
          cancelled: "Transaction cancelled.",
          reversed: "Reversal completed.",
        },
      },
      table: {
        id: "ID",
        txnNo: "Transaction No",
        txnType: "Type",
        status: "Status",
        register: "Register",
        session: "Session",
        bookDate: "Book Date",
        amount: "Amount",
        currency: "Currency",
        counterparty: "Counterparty",
        counterAccount: "Counter Account",
        counterRegister: "Counter Register",
        links: "Links",
        postedJournal: "Posted Journal",
        overrideReason: "Override Reason",
        createdAt: "Created At",
        actions: "Actions",
      },
      values: {
        notApplicable: "Not applicable",
        readOnly: "Read-only",
        statusDraft: "Draft",
        statusSubmitted: "Submitted",
        statusApproved: "Approved",
        statusPosted: "Posted",
        statusReversed: "Reversed",
        statusCancelled: "Cancelled",
        loadingCounterparties: "Loading counterparties...",
        selectedCounterparty:
          "Selected counterparty: {{code}} - {{name}} ({{type}})",
        selectedCounterAccount: "Selected account: {{code}} - {{name}}",
        selectedBankCounterAccount:
          "Selected bank account: {{code}} - {{name}} (GL: {{glCode}})",
        linked: "Linked",
        transitStatusInitiated: "Initiated",
        transitStatusInTransit: "In transit",
        transitStatusReceived: "Received",
        transitStatusCanceled: "Cancelled",
        transitStatusReversed: "Reversed",
        transitBadge: "Transit #{{transferId}} ({{status}})",
        transitPairBadge: "OUT #{{outTxnId}} / IN #{{inTxnId}}",
        settlementBadge: "Settlement #{{settlementBatchId}}",
        unappliedBadge: "Unapplied #{{unappliedCashId}}",
      },
      apply: {
        openDocsTitle: "Open documents picker (no raw ID typing)",
        openDocsDescription:
          "Enter amounts for each open item to apply. Leave all amounts empty to store the full transaction as unapplied cash.",
        selectedTotal: "Selected total: {{total}}",
        loadingOpenDocuments: "Loading open documents...",
        noOpenDocuments: "No open documents found for this transaction.",
        table: {
          document: "Doc",
          openItem: "OpenItem",
          dueDate: "Due",
          openAmount: "Open",
          applyAmount: "Apply",
        },
      },
      warnings: {
        registerLookupUnavailable:
          "Register lookups could not be loaded; you may need to enter register fields manually.",
        sessionLookupUnavailable:
          "Session lookups could not be loaded; you may need to enter cashSessionId manually.",
        accountLookupUnavailable:
          "Account lookups could not be loaded; you may need to enter counterAccountId manually.",
        bankAccountLookupUnavailable:
          "Bank account lookups could not be loaded; you may need to enter the bank GL account manually.",
        counterpartyPickerUnavailableManual:
          "Counterparty picker is unavailable; use manual counterparty ID.",
        noRegisterList:
          "No register list is available. Go to Cash Registers and create/activate at least one register.",
        bankCounterAccountPermissionMissing:
          "Bank account picker is unavailable because bank.accounts.read permission is missing. Enter the bank GL account manually.",
        bankCounterAccountNeedsRegister:
          "Select a register first before choosing a bank account.",
        bankCounterAccountNeedsLegalEntity:
          "Bank account picker could not start because selected register has no legal entity context.",
        noActiveBankAccountsForRegister:
          "No active bank accounts were found for the selected legal entity. Create one first.",
        sessionPickerNeedsRegister:
          "Select a register first before choosing a session. If none exists, create one in Cash Registers.",
        noOpenSessionForRegister:
          "No OPEN session was found for the selected register. Open a new session from Cash Sessions.",
        counterpartyPickerPermissionMissing:
          "Counterparty picker is unavailable because cari.card.read permission is missing. Enter counterparty ID manually.",
        counterpartyPickerNeedsRegister:
          "Counterparty picker needs a selected register first. If none exists, create one in Cash Registers.",
        counterpartyPickerNeedsLegalEntity:
          "Counterparty picker could not start because selected register has no legal entity context. Review the register in Cash Registers.",
        registerInactive: "Selected register is not ACTIVE.",
        currencyMismatch:
          "Transaction currency does not match register currency (register: {{registerCurrency}}).",
        maxAmountExceeded:
          "Transaction amount exceeds register maxTxnAmount limit (max: {{max}}).",
        crossOuTransitCounterRequired:
          "Transfers between different operating-unit contexts use cash transit and self-balancing current-account setup.",
        crossOuTransitSelfBalancingInfo:
          "Cross-context transit uses self-balancing current-account setup. No transit-clearing account selection is needed on this form.",
        crossOuTransferInUseTransitReceive:
          "Use Transit Receive action for transfer-in between different operating-unit contexts.",
        expectedCounterpartyTypeForTxn:
          "Expected counterparty type {{expected}} for {{txnType}}.",
        recommendCounterpartyType:
          "Set counterparty type {{expected}} for better apply compatibility.",
        sessionModeNone:
          "Selected register has session_mode=NONE. cashSessionId can be empty.",
        sessionRequiredNoOpen:
          "Selected register has no OPEN session; create/post flow may be blocked.",
      },
      errors: {
        missingReadPermission:
          "cash.txn.read permission is required to use this page.",
        missingCreatePermission:
          "cash.txn.create permission is required for this action.",
        missingPostPermission:
          "cash.txn.post permission is required for this action.",
        missingCancelPermission:
          "cash.txn.cancel permission is required for this action.",
        missingReversePermission:
          "cash.txn.reverse permission is required for this action.",
        missingOverridePermission:
          "cash.override.post permission is required for this action.",
        load: "Failed to load cash transactions.",
        create: "Failed to create cash transaction.",
        action: "Failed to complete transaction action.",
        requestId: "Request ID: {{requestId}}",
        actionRowMissing: "No valid transaction selected for action.",
        openDocumentsPermissionMissing:
          "Open document picker requires permission: cari.report.read",
        openDocumentsLoadNotAllowedForRow:
          "Selected transaction cannot load Cari open documents.",
        openDocumentsLoadFailed: "Failed to load open documents for apply.",
        registerRequired: "registerId is required.",
        txnDatetimeRequired: "txnDatetime is required.",
        bookDateRequired: "bookDate is required.",
        amountRequired: "amount is required.",
        amountInvalid: "amount is invalid.",
        currencyRequired: "currencyCode is required.",
        invalidTxnType: "Invalid transaction type.",
        counterAccountRequired:
          "counterAccountId is required for this transaction type.",
        counterRegisterRequired:
          "counterCashRegisterId is required for this transaction type.",
        counterRegisterSame:
          "counterCashRegisterId cannot be the same as registerId.",
        registerInactive: "Selected register is not ACTIVE.",
        crossOuTransferInMustUseTransitReceive:
          "Transfer-in between different operating-unit contexts must be created from Transit Receive action.",
        missingApplyCariPermission: "Missing permission: cari.settlement.apply",
        transitTransferLinkMissing:
          "Transit transfer link is missing on this row.",
        transitTransferIdRequired: "transitTransferId is required.",
        onlyReceiptPayoutCanApplyCari:
          "Only RECEIPT/PAYOUT transactions can be applied to Cari.",
        applyCounterpartyTypeMismatch:
          "Transaction requires counterpartyType={{expected}} and a valid counterpartyId.",
        settlementDateRequired: "settlementDate is required.",
        overApplyDetected: "Over-apply detected for openItemId={{openItemId}}.",
        applySelectedTotalExceedsCashAmount:
          "Selected application total exceeds cash transaction amount.",
        currencyMismatch:
          "Transaction currency does not match register currency (register: {{registerCurrency}}).",
        maxAmountExceeded:
          "Transaction amount exceeds register maxTxnAmount limit (max: {{max}}).",
        sessionRequiredNoOpen:
          "No OPEN session found for selected register; create is blocked.",
        postStatusInvalid:
          "Only DRAFT/SUBMITTED/APPROVED transactions can be posted.",
        cancelStatusInvalid:
          "Only DRAFT/SUBMITTED transactions can be cancelled.",
        reverseStatusInvalid: "Only POSTED transactions can be reversed.",
        reverseReversalNotAllowed:
          "Reversal transactions cannot be reversed again.",
        overrideReasonRequired:
          "overrideReason is required when overrideCashControl=true.",
        cancelReasonRequired: "cancelReason is required.",
        reverseReasonRequired: "reverseReason is required.",
      },
      errorsMapped: {
        registerNotFound: "Selected register was not found.",
        sessionNotFound: "Selected session was not found.",
        sessionRegisterMismatch:
          "Selected session does not belong to selected register.",
        sessionNotOpen: "Selected session is not OPEN.",
        counterRegisterNotFound: "Counter register was not found.",
        counterAccountInvalid:
          "Counter account is invalid or outside tenant scope.",
        counterAccountInvalidBank:
          "For bank transactions, the counter account must be an active bank-linked GL account in the selected legal entity.",
        postRequiresOpenSession: "Posting requires an OPEN cash session.",
        currencyMismatchGeneric:
          "Transaction currency must match register currency.",
        maxAmountExceededGeneric:
          "Transaction amount exceeds register maxTxnAmount limit.",
        transactionNotFound: "Selected cash transaction was not found.",
        idempotencyDuplicate:
          "A transaction already exists with the same idempotency key.",
        systemGeneratedOnly:
          "This transaction type can only be system-generated.",
        transitSourceTargetOuMismatch:
          "Transit workflow requires source and target registers in different operating-unit contexts.",
        transitCrossLegalEntityNotSupported:
          "Cross-legal-entity transit transfer is not supported.",
        transitMustBeInTransitBeforeReceive:
          "Transit transfer must be IN_TRANSIT before receive.",
        transitTransferOutMustBePostedBeforeReceive:
          "Transfer-out must be POSTED before receive.",
        transitAlreadyReceived: "Transit transfer is already received.",
        transitReverseTransferInFirst:
          "Reverse transfer-in first; transfer-out cannot be reversed after receive.",
        ouSelfBalancingSetupInvalid:
          "Cross-context transfer posting is blocked until the required central or branch-pair current-account mappings are ready. Run the saved current-account repair during Transfer Out in Kasa Islemleri or in Organization Management.",
        applyRequiresPostedTxn: "Cash transaction must be POSTED before apply.",
        applyCounterpartyInvalid:
          "Cash transaction counterparty is invalid for Cari apply.",
        applyTotalExceedsAvailable: "Applied total exceeds available amount.",
        applyOpenItemResidualExceeded:
          "Selected apply amount exceeds open document residual.",
        applyNoOpenDocs:
          "No open Cari documents found for selected counterparty.",
        applyAlreadyLinked:
          "This cash transaction is already linked to another Cari settlement.",
      },
      messages: {
        created: "Cash transaction created.",
        posted: "Cash transaction posted.",
        cancelled: "Cash transaction cancelled.",
        reversed: "Reversal created. Reversal ID: {{reversalId}}.",
        transitReplay: "Transit transfer replayed. transferId={{transferId}}",
        transitInitiated:
          "Transit initiated. transferId={{transferId}}, transferOutTxnId={{transferOutTxnId}}",
        transitReceiveReplay:
          "Transit receive replayed. transferInTxnId={{transferInTxnId}}",
        transitReceived:
          "Transit received. transferInTxnId={{transferInTxnId}}",
        applyReplayReturned:
          "Apply request replayed; existing Cari linkage returned.",
        applyCompletedSettlement:
          "Cari apply completed. settlementBatchId={{settlementBatchId}}",
        applyCreatedUnapplied:
          "Cari unapplied cash created. unappliedCashId={{createdUnappliedCashId}}",
        applyCompleted: "Cari apply completed.",
        idempotentReplay:
          "This request was already processed; existing transaction returned.",
      },
    },
    cashExchanges: {
      sections: {
        exchangeBatches: "Exchange Batches",
        createExchangeBatch: "Create Exchange Batch",
        selectedBatchDetail: "Selected Batch Detail",
      },
      postingModes: {
        clearing: "CLEARING (staged FX)",
        direct: "DIRECT (safe-to-safe)",
      },
      form: {
        postingMode: "Posting Mode",
        directModeHelp:
          "Direct mode posts source safe vs target safe without a staged clearing account.",
        clearingModeHelp:
          "Use staged clearing when the FX exchange should park value in a clearing account before completion.",
        clearingAccount: "Clearing Account",
        directModeNoClearing: "No clearing account is used in direct mode.",
        clearingAccountHelp:
          "If CASH_EXCHANGE_CLEARING is configured in GL setup it prefills here. A dedicated 108.xx asset account is a good fit for staged FX clearing.",
        commissionAmountTxn: "Commission Amount (Txn)",
        commissionAmountBase: "Commission Amount (Base)",
        commissionAccount: "Commission Account",
        selectCommissionAccount: "Select",
        commissionHelp:
          "Commission is optional. When entered, a commission account is required.",
        spreadReferenceRate: "Spread Reference Rate",
        spreadRateDelta: "Spread Rate Delta",
        spreadAmountBase: "Spread Amount (Base)",
        searchClearingAccount: "Search clearing account code/name",
        selectSourceRegisterFirst: "Select source register first",
        noClearingAccounts: "No clearing accounts found.",
      },
      values: {
        clearingUsage: "Clearing",
        noClearing: "No clearing",
        commissionAmount: "Commission",
        spreadAmount: "Spread",
        commissionAccount: "Commission Account",
        noCommissionAccount: "No commission account",
      },
      detail: {
        selectPrompt:
          "Select a batch number from the table to inspect linked transactions.",
        loading: "Loading batch detail...",
        postingMode: "Posting Mode",
        clearingUsage: "Clearing Usage",
        commissionAccount: "Commission Account",
        commissionAmount: "Commission Amount",
        spreadAmount: "Spread Amount",
        sourceRegister: "Source Register",
        targetRegister: "Target Register",
        exchangeTransactions: "Exchange Transactions",
        sourceTxn: "Out",
        targetTxn: "In",
        rawJson: "Raw JSON",
      },
      actions: {
        saving: "Saving...",
        create: "Create Exchange",
      },
      table: {
        loading: "Loading exchange batches...",
        empty: "No exchange batches found.",
      },
      errors: {
        missingCreatePermission: "Missing permission: cash.txn.create",
        registersRequired:
          "sourceRegisterId and targetRegisterId are required.",
        registersMustDiffer:
          "sourceRegisterId and targetRegisterId must be different.",
        amountsRequired:
          "sourceAmountTxn and targetAmountTxn must be positive numbers.",
        idempotencyRequired: "idempotencyKey is required.",
        fxRateInvalid: "FX rate must be a positive number.",
        commissionAmountTxnInvalid:
          "Commission amount (txn) must be a positive number.",
        commissionAmountBaseInvalid:
          "Commission amount (base) must be a positive number.",
        spreadReferenceRateInvalid:
          "Spread reference rate must be a positive number.",
        spreadAmountBaseInvalid:
          "Spread amount (base) must be a positive number.",
        spreadRateDeltaInvalid: "Spread rate delta must be numeric.",
        commissionAccountRequired:
          "Commission account is required when commission amount is provided.",
        commissionAmountRequired:
          "Commission amount is required when commission account is provided.",
        create: "Cash exchange could not be created.",
      },
      messages: {
        savedWithId: "Cash exchange batch #{{id}} saved successfully.",
        saved: "Cash exchange batch saved successfully.",
      },
    },
    cashExceptions: {
      title: "Cash Exceptions",
      subtitle:
        "Monitor operational exceptions derived from cash sessions and cash transactions.",
      glWarningNote:
        "This page includes both derived cash exceptions and direct GL cash-control events.",
      requestId: "Request ID: {{requestId}}",
      sections: {
        filters: "Filters",
        highVariance: "High Variance Sessions",
        forcedClose: "Forced Close Sessions",
        overrideUsage: "Override Usage Transactions",
        unposted: "Unposted Transactions",
        glCashControlEvents: "Direct GL Cash-Control Events",
        notes: "Notes",
      },
      actions: {
        apply: "Apply Filters",
        clear: "Clear",
        refresh: "Refresh",
        loading: "Loading...",
      },
      filters: {
        allLegalEntities: "All legal entities",
        allOperatingUnits: "All operating units",
        allRegisters: "All registers",
        fromDate: "From Date",
        toDate: "To Date",
        minAbsVariance: "Minimum absolute variance",
      },
      cards: {
        highVariance: "High Variance",
        forcedClose: "Forced Close",
        overrideUsage: "Override Usage",
        unposted: "Unposted",
        glCashControlEvents: "GL Cash-Control",
      },
      table: {
        register: "Register",
        legalEntity: "Legal Entity",
        operatingUnit: "Operating Unit",
        status: "Status",
        expected: "Expected",
        counted: "Counted",
        variance: "Variance",
        closedAt: "Closed At",
        closedReason: "Closed Reason",
        closeNote: "Close Note",
        closedBy: "Closed By",
        txnNo: "Transaction No",
        txnType: "Transaction Type",
        bookDate: "Book Date",
        amount: "Amount",
        overrideReason: "Override Reason",
        postedJournal: "Posted Journal",
        createdAt: "Created At",
        action: "Action",
        journalNo: "Journal No",
        resource: "Resource",
        scope: "Scope",
        requestId: "Request ID",
        payload: "Payload",
      },
      empty: {
        highVariance: "No high-variance sessions matched the current filters.",
        forcedClose: "No forced-close sessions matched the current filters.",
        overrideUsage:
          "No override-usage transactions matched the current filters.",
        unposted: "No unposted transactions matched the current filters.",
        glCashControlEvents:
          "No direct GL cash-control events matched the current filters.",
      },
      values: {
        glActionWarn: "Warning",
        glActionOverride: "Override",
      },
      errors: {
        missingReadPermission:
          "cash.report.read permission is required to use this page.",
        invalidVarianceThreshold:
          "Minimum absolute variance must be zero or a positive number.",
        invalidDateRange: "From date cannot be greater than to date.",
        load: "Failed to load cash exception data.",
      },
      warnings: {
        registerLookupUnavailable:
          "Register lookup data is unavailable; filter options may be limited.",
        sessionsUnavailable:
          "Cash session data is temporarily unavailable; exception sections are partially populated.",
        transactionsUnavailable:
          "Cash transaction data is temporarily unavailable; exception sections are partially populated.",
      },
    },
    cariCounterparty: {
      accountPickerPermissionMissing:
        "AR/AP account pickers are hidden because gl.account.read permission is missing.",
      accountPickerLoadError:
        "Failed to load account options for selected legal entity.",
      arAccountLabel: "AR Control Account Override",
      apAccountLabel: "AP Control Account Override",
    },
    cariDocuments: {
      title: "Cari Documents",
      createDraft: "Create draft document",
      updateDraft: "Update draft document",
      cancelDraft: "Cancel draft",
      postDraft: "Post draft",
      reversePosted: "Reverse posted document",
    },
    cariAudit: {
      title: "Cari Audit Trail",
      subtitle:
        "Filter audit log rows for finance/support investigations and trace request IDs quickly.",
      byActionTitle: "Action Summary",
    },
    cariSettlements: {
      title: "Cari Settlements",
      apply: "Apply settlement",
      reverse: "Reverse settlement",
      replayInfo:
        "This request was already processed; existing result is shown.",
      directionRequired: "Direction is required for auto-allocation.",
      mixedDirectionWarning:
        "Open-item rows are mixed AR/AP. Select one direction before auto-allocation.",
    },
    modulePlaceholder: {
      defaultTitle: "Module",
      description:
        "This module route is active, but the full screen and workflow are not implemented yet.",
      routeLabel: "Route:",
      yearEndReminder: {
        title: "Year-end note (placeholder)",
        description:
          "Reminder trail for the future detailed checklist: validate long/short reclass and accrual closing steps.",
        reclassDeferredRevenue:
          "Validate deferred revenue long->short reclass (480 -> 380).",
        reclassPrepaidExpense:
          "Validate prepaid expense long->short reclass (280 -> 180).",
        reclassAccruedRevenue:
          "Validate accrued revenue long->short reclass (281 -> 181).",
        reclassAccruedExpense:
          "Validate accrued expense long->short reclass (481 -> 381).",
        closeAccruals:
          "Plan period-end accrual/deferred closing and next-period opening checks.",
      },
    },
    readinessChecklist: {
      title: "Tenant Bootstrap Checklist",
      loading: "Loading bootstrap status...",
      retry: "Retry",
      refresh: "Refresh",
      showDetails: "Show details",
      hideDetails: "Hide details",
      summary: "{{ready}} / {{total}} complete",
      description:
        "Complete the tenant shell, organization, and GL foundation before moving on to legal-entity activation.",
      minimum: "{{count}} / minimum {{minimum}}",
      missing: "Missing:",
      setupStepsTitle: "Quick links for missing setup steps",
      checkLabels: {
        groupCompanies: "Group companies",
        legalEntities: "Legal entities",
        fiscalCalendars: "Fiscal calendars",
        fiscalPeriods: "Fiscal periods",
        books: "Books",
        openBookPeriods: "Open book periods",
        chartsOfAccounts: "Charts of accounts",
        accounts: "Accounts",
        subaccountsV1: "Subaccounts V1 (warning placeholder)",
        setupWizardV2: "Setup Wizard V2 (warning placeholder)",
        consolidationCanonicalMappingV1:
          "Consolidation canonical mapping (warning placeholder)",
        taxEngineV1: "Country tax engine setup (optional)",
      },
      badges: {
        ready: "Ready",
        setupRequired: "Setup Required",
        ok: "OK",
        missing: "Missing",
      },
      links: {
        company: "Company Setup",
        org: "Org Setup",
        gl: "GL Setup",
      },
      bootstrap: {
        title: "One-click baseline bootstrap",
        run: "Run Baseline Bootstrap",
        running: "Running...",
        missingPermission: "Missing permission: onboarding.company.setup",
        completed: "Baseline bootstrap completed.",
      },
    },
    readinessGuard: {
      checking: "Checking tenant bootstrap readiness...",
      failedTitle: "Tenant bootstrap check failed",
      retry: "Retry",
    },
    chartOfAccountsCreate: {
      title: "Create Chart of Accounts",
    },
  },
};
