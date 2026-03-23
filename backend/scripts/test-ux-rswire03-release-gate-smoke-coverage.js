import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const BASELINE_CANONICAL_IMPLEMENTED_ROUTES = new Set([
  "/app/acilis-fisi",
  "/app/alis-faturalari",
  "/app/ayarlar/exception-workbench",
  "/app/ayarlar/hesap-plani-ayarlari",
  "/app/ayarlar/hesap-plani-olustur",
  "/app/ayarlar/hesap-yeniden-siniflandirma",
  "/app/ayarlar/cari-denetim",
  "/app/ayarlar/konsolidasyon-kurulumu",
  "/app/ayarlar/kur-yonetimi",
  "/app/ayarlar/operasyon-dashboard",
  "/app/ayarlar/organizasyon-yonetimi",
  "/app/ayarlar/rbac/audit-logs",
  "/app/ayarlar/rbac/roles-permissions",
  "/app/ayarlar/rbac/scope-assignments",
  "/app/ayarlar/rbac/sensitive-data-audit",
  "/app/ayarlar/rbac/user-assignments",
  "/app/ayarlar/sirket-ayarlari",
  "/app/ayarlar/veri-saklama-snapshot",
  "/app/banka-ekstre-ice-aktar",
  "/app/banka-ekstre-kuyrugu",
  "/app/banka-mutabakat",
  "/app/banka-onaylar",
  "/app/banka-tanimla",
  "/app/contracts",
  "/app/donem-sonu-islemler/aylik/intercompany-mutabakat",
  "/app/donem-sonu-islemler/yillik/konsolidasyon-raporlari",
  "/app/gelecek-yillar-gelirleri",
  "/app/kasa-islemleri",
  "/app/kasa-istisnalari",
  "/app/kasa-oturumlari",
  "/app/kasa-tanimlari",
  "/app/kasa-transit-transferleri",
  "/app/mahsup-islemleri",
  "/app/musteri-kartlari",
  "/app/musteri-kartlari/olustur",
  "/app/musteri-raporlari",
  "/app/musteri-tahsilatlar",
  "/app/odeme-batchleri",
  "/app/payroll-beneficiaries",
  "/app/payroll-close-controls",
  "/app/payroll-liabilities",
  "/app/payroll-mappings",
  "/app/payroll-runs",
  "/app/payroll-runs/import",
  "/app/satis-faturalari",
  "/app/tahsilat-islemleri",
  "/app/tedarikci-kartlari",
  "/app/tedarikci-kartlari/olustur",
  "/app/tedarikci-odemeler",
  "/app/tedarikci-raporlari",
  "/app/tediye-islemleri",
]);

const LOCKED_MANIFEST_ENTRIES = Object.freeze({
  "/app/stok-transferleri": {
    smokeScriptPath: "backend/scripts/test-ou-self-balancing-release-gate.js",
    packageScriptName: "test:ou:self-balancing:release-gate",
  },
});

function stripQuotes(value) {
  const raw = String(value || "").trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseConstantStringMap(appSource) {
  const constants = new Map();
  const re = /const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(["'])(.*?)\2\s*;/g;
  let match = re.exec(appSource);
  while (match) {
    constants.set(match[1], match[3]);
    match = re.exec(appSource);
  }
  return constants;
}

function parseCanonicalImplementedRoutes(appSource) {
  const blockMatch = appSource.match(
    /const\s+implementedRoutes\s*=\s*\[([\s\S]*?)\n\];/
  );
  assert(blockMatch?.[1], "Could not parse implementedRoutes block from App.jsx");

  const constMap = parseConstantStringMap(appSource);
  const chunks = blockMatch[1]
    .split(/\n\s*},\n/g)
    .map((row) => row.trim())
    .filter(Boolean);

  const routes = [];
  for (const chunk of chunks) {
    const appPathMatch = chunk.match(/appPath:\s*([^,\n]+)/);
    const elementMatch = chunk.match(/element:\s*<([A-Za-z0-9_]+)/);
    if (!appPathMatch || !elementMatch) {
      continue;
    }

    const appPathToken = stripQuotes(appPathMatch[1]);
    const resolvedPath = appPathToken.startsWith("/")
      ? appPathToken
      : constMap.get(appPathToken) || null;
    if (!resolvedPath || !resolvedPath.startsWith("/app/")) {
      continue;
    }
    if (
      elementMatch[1] === "Navigate" ||
      elementMatch[1] === "LegacyRouteRedirect" ||
      resolvedPath.includes(":")
    ) {
      continue;
    }

    routes.push(resolvedPath);
  }

  return Array.from(new Set(routes)).sort();
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const appSource = await readFile(path.resolve(root, "frontend/src/App.jsx"), "utf8");
  const packageSource = await readFile(path.resolve(root, "backend/package.json"), "utf8");
  const manifestSource = await readFile(
    path.resolve(root, "backend/scripts/fixtures/rswire03-release-gate-manifest.json"),
    "utf8"
  );

  const pkg = JSON.parse(packageSource);
  const scripts = pkg?.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const manifest = JSON.parse(manifestSource);
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];

  const canonicalRoutes = parseCanonicalImplementedRoutes(appSource);
  const newRoutes = canonicalRoutes.filter(
    (routePath) => !BASELINE_CANONICAL_IMPLEMENTED_ROUTES.has(routePath)
  );

  const entryByRoute = new Map();
  for (const entry of entries) {
    const routePath = String(entry?.routePath || "").trim();
    if (!routePath) {
      continue;
    }
    entryByRoute.set(routePath, entry);
  }

  for (const routePath of newRoutes) {
    const entry = entryByRoute.get(routePath);
    assert(
      entry,
      `RS-WIRE-03 failed: newly implemented route ${routePath} is missing manifest entry (backend/scripts/fixtures/rswire03-release-gate-manifest.json)`
    );

    const smokePath = String(entry?.smokeScriptPath || "").trim();
    assert(
      smokePath,
      `RS-WIRE-03 failed: manifest entry for ${routePath} must define smokeScriptPath`
    );

    const resolvedSmokePath = path.resolve(root, smokePath);
    await readFile(resolvedSmokePath, "utf8");

    const scriptName = String(entry?.packageScriptName || "").trim();
    assert(
      scriptName,
      `RS-WIRE-03 failed: manifest entry for ${routePath} must define packageScriptName`
    );
    assert(
      typeof scripts[scriptName] === "string",
      `RS-WIRE-03 failed: package.json script ${scriptName} not found for ${routePath}`
    );
    assert(
      scripts[scriptName].includes(smokePath.replace("backend/", "")) ||
        scripts[scriptName].includes(smokePath),
      `RS-WIRE-03 failed: package script ${scriptName} does not reference ${smokePath}`
    );
  }

  for (const [routePath, expected] of Object.entries(LOCKED_MANIFEST_ENTRIES)) {
    const entry = entryByRoute.get(routePath);
    assert(entry, `RS-WIRE-03 failed: locked manifest route missing: ${routePath}`);
    assert(
      String(entry?.smokeScriptPath || "").trim() === expected.smokeScriptPath,
      `RS-WIRE-03 failed: ${routePath} smokeScriptPath must be ${expected.smokeScriptPath}`
    );
    assert(
      String(entry?.packageScriptName || "").trim() === expected.packageScriptName,
      `RS-WIRE-03 failed: ${routePath} packageScriptName must be ${expected.packageScriptName}`
    );
  }

  console.log(
    `RS-WIRE-03 guard passed (${canonicalRoutes.length} canonical routes, ${newRoutes.length} new route(s) needing manifest coverage).`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
