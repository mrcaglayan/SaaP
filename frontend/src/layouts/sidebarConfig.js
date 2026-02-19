const ROLE_PERMISSIONS_PAGE_PERMISSIONS = [
  "security.role.read",
  "security.permission.read",
  "security.role.upsert",
  "security.role_permissions.assign",
];

const USER_ASSIGNMENTS_PAGE_PERMISSIONS = [
  "security.role_assignment.read",
  "security.role_assignment.upsert",
];

const SCOPE_ASSIGNMENTS_PAGE_PERMISSIONS = [
  "security.data_scope.read",
  "security.data_scope.upsert",
  "security.role_assignment.read",
];

const AUDIT_LOGS_PAGE_PERMISSIONS = ["security.audit.read"];
const COMPANY_SETTINGS_PAGE_PERMISSIONS = ["onboarding.company.setup"];
const ORG_SETTINGS_PAGE_PERMISSIONS = ["org.tree.read", "org.fiscal_calendar.read"];
const GL_SETUP_PAGE_PERMISSIONS = [
  "gl.book.read",
  "gl.coa.read",
  "gl.account.read",
  "gl.book.upsert",
  "gl.coa.upsert",
  "gl.account.upsert",
  "gl.account_mapping.upsert",
];
const JOURNAL_PAGE_PERMISSIONS = [
  "gl.journal.read",
  "gl.journal.create",
  "gl.journal.post",
  "gl.journal.reverse",
  "gl.trial_balance.read",
  "gl.period.close",
];

export const sidebarItems = [
  {
    type: "link",
    label: "Dashboard",
    to: "/app",
    end: true,
    icon: "dashboard",
    implemented: true,
  },
  {
    type: "section",
    title: "Donem Islemleri",
    icon: "spark",
    matchPrefix: "/app/donem-islemleri",
    items: [
      {
        label: "Acilis Fisi Olustur",
        to: "/app/acilis-fisi",
        implemented: true,
      },
    ],
  },
  {
    type: "section",
    title: "Yevmiye Kayitlari",
    icon: "journal",
    matchPrefix: "/app/yevmiye-kayitlari",
    items: [
      {
        label: "Tediye",
        to: "/app/tediye-islemleri",
      },
      {
        label: "Tahsilat",
        to: "/app/tahsilat-islemleri",
      },
      {
        label: "Mahsup",
        to: "/app/mahsup-islemleri",
        requiredPermissions: JOURNAL_PAGE_PERMISSIONS,
        implemented: true,
      },
    ],
  },
  {
    type: "section",
    title: "Banka Islemleri",
    icon: "bank",
    matchPrefix: "/app/banka-islemleri",
    items: [
      {
        label: "Banka Tanimla",
        to: "/app/banka-tanimla",
      },
      {
        label: "Banka Islemleri",
        to: "/app/banka-islemleri",
      },
    ],
  },
  {
    type: "section",
    title: "Cari Islemler",
    icon: "company",
    matchPrefix: "/app/cari-islemler",
    items: [
      {
        label: "Alici Karti Olustur",
        to: "/app/alici-kart-olustur",
      },
      {
        label: "Alici Karti Listesi",
        to: "/app/alici-kart-listesi",
      },
      {
        label: "Satici Karti Olustur",
        to: "/app/satici-kart-olustur",
      },
      {
        label: "Satici Karti Listesi",
        to: "/app/satici-kart-listesi",
      },
    ],
  },
  {
    type: "section",
    title: "Stoklar",
    icon: "box",
    matchPrefix: "/app/stoklar",
    items: [
      {
        label: "Stok Karti Olustur",
        to: "/app/stok-karti-olustur",
      },
      {
        label: "Stok Yansitma Islemleri",
        to: "/app/stok-yansitma-islemleri",
      },
      {
        label: "Stok Karti Listesi",
        to: "/app/stok-karti-listesi",
      },
    ],
  },
  {
    type: "section",
    title: "Demirbaslar",
    icon: "inventory",
    matchPrefix: "/app/demirbaslar",
    items: [
      {
        label: "Demirbas Karti Olustur",
        to: "/app/demirbas-karti-olustur",
      },
      {
        label: "Demirbas Alim Islemleri",
        to: "/app/demirbas-alim-islemleri",
      },
      {
        label: "Demirbas Satis Islemleri",
        to: "/app/demirbas-satis-islemleri",
      },
      {
        label: "Amortisman Ayarlari",
        to: "/app/demirbas-amortisman-ayarlar",
      },
    ],
  },
  {
    type: "section",
    title: "Donem Sonu Islemler",
    icon: "calendar",
    matchPrefix: "/app/donem-sonu-islemler",
    items: [
      {
        type: "section",
        title: "Aylik Donem Sonu Islemler",
        icon: "calendar",
        matchPrefix: "/app/donem-sonu-islemler/aylik",
        items: [
          {
            label: "Degerleme Islemleri",
            to: "/app/donem-sonu-islemler/aylik/degerleme-islemleri",
          },
          {
            label: "Amortisman Islemleri",
            to: "/app/donem-sonu-islemler/aylik/amortisman-islemleri",
          },
          {
            label: "Beyanname Islemleri",
            to: "/app/donem-sonu-islemler/aylik/beyanname-islemleri",
          },
        ],
      },
      {
        type: "section",
        title: "Yillik Donem Sonu Islemleri",
        icon: "calendar",
        matchPrefix: "/app/donem-sonu-islemler/yillik",
        items: [
          {
            label: "Envanter Islemleri",
            to: "/app/donem-sonu-islemler/yillik/envanter-islemleri",
          },
          {
            label: "Kapanis Islemleri",
            to: "/app/donem-sonu-islemler/yillik/kapanis-islemleri",
          },
          {
            label: "Yansitma Islemleri",
            to: "/app/donem-sonu-islemler/yillik/yansitma-islemleri",
          },
        ],
      },
    ],
  },
  {
    type: "section",
    title: "Raporlar",
    icon: "report",
    matchPrefix: "/app/raporlar",
    items: [
      {
        label: "Defter-i Kebir",
        to: "/app/defter-i-kebir",
      },
      {
        label: "Bilanco",
        to: "/app/bilanco",
      },
      {
        label: "Gelir Tablosu",
        to: "/app/gelir-tablosu",
      },
      {
        label: "Stok Raporu",
        to: "/app/stok-raporu",
      },
      {
        label: "Demirbas Raporu",
        to: "/app/demirbas-raporu",
      },
      {
        label: "Mizan Raporu",
        to: "/app/mizan-raporu",
      },
    ],
  },
  {
    type: "section",
    title: "Ayarlar",
    icon: "settings",
    matchPrefix: "/app/ayarlar",
    items: [
      {
        label: "Kullanici Yonetimi",
        to: "/app/ayarlar/kullanici-yonetimi",
      },
      {
        label: "Roller ve Yetkiler",
        to: "/app/ayarlar/rbac/roles-permissions",
        requiredPermissions: ROLE_PERMISSIONS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Kullanici Rol Atamalari",
        to: "/app/ayarlar/rbac/user-assignments",
        requiredPermissions: USER_ASSIGNMENTS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Scope Atamalari",
        to: "/app/ayarlar/rbac/scope-assignments",
        requiredPermissions: SCOPE_ASSIGNMENTS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "RBAC Denetim Loglari",
        to: "/app/ayarlar/rbac/audit-logs",
        requiredPermissions: AUDIT_LOGS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Sirket Ayarlari",
        to: "/app/ayarlar/sirket-ayarlari",
        requiredPermissions: COMPANY_SETTINGS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Organizasyon Yonetimi",
        to: "/app/ayarlar/organizasyon-yonetimi",
        requiredPermissions: ORG_SETTINGS_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Hesap Plani Olustur",
        to: "/app/ayarlar/hesap-plani-olustur",
        implemented: true,
      },
      {
        label: "Hesap Plani Ayarlari",
        to: "/app/ayarlar/hesap-plani-ayarlari",
        requiredPermissions: GL_SETUP_PAGE_PERMISSIONS,
        implemented: true,
      },
      {
        label: "Stok Ayarlari",
        to: "/app/ayarlar/stok-ayarlari",
      },
      {
        label: "Demirbas Ayarlari",
        to: "/app/ayarlar/demirbas-ayarlari",
      },
    ],
  },
];

function isSectionItem(item) {
  return item?.type === "section" || Array.isArray(item?.items);
}

export function collectSidebarLinks(items = sidebarItems) {
  const byPath = new Map();

  function walk(nodes) {
    if (!Array.isArray(nodes)) {
      return;
    }

    for (const node of nodes) {
      if (isSectionItem(node)) {
        walk(node.items);
        continue;
      }

      if (node?.to && !byPath.has(node.to)) {
        byPath.set(node.to, node);
      }
    }
  }

  walk(items);
  return Array.from(byPath.values());
}
