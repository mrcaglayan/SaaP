import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

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

function parseImplementedRoutes(appSource) {
  const blockMatch = appSource.match(
    /const\s+implementedRoutes\s*=\s*\[([\s\S]*?)\n\];/
  );
  if (!blockMatch?.[1]) {
    throw new Error("Could not parse implementedRoutes block from App.jsx");
  }

  const constMap = parseConstantStringMap(appSource);
  const normalizedBlock = blockMatch[1].replace(/\r\n/g, "\n");
  const chunks = normalizedBlock
    .split(/\n\s*},\n/g)
    .map((row) => row.trim())
    .filter(Boolean);

  const routes = [];
  for (const chunk of chunks) {
    const appPathMatch = chunk.match(/appPath:\s*([^,\n]+)/);
    const permissionPathMatch = chunk.match(/permissionPath:\s*([^,\n]+)/);
    const elementMatch = chunk.match(/element:\s*<([A-Za-z0-9_]+)/);
    if (!appPathMatch || !elementMatch) {
      continue;
    }

    const token = stripQuotes(appPathMatch[1]);
    const resolvedPath = token.startsWith("/")
      ? token
      : constMap.get(token) || null;
    const permissionToken = permissionPathMatch
      ? stripQuotes(permissionPathMatch[1])
      : null;
    const resolvedPermissionPath = permissionToken
      ? permissionToken.startsWith("/")
        ? permissionToken
        : constMap.get(permissionToken) || null
      : null;
    if (!resolvedPath || !resolvedPath.startsWith("/app/")) {
      continue;
    }

    routes.push({
      appPath: resolvedPath,
      permissionPath: resolvedPermissionPath,
      componentName: elementMatch[1],
    });
  }
  return routes;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const appSource = await readFile(path.resolve(root, "frontend/src/App.jsx"), "utf8");
  const sidebarSource = await readFile(
    path.resolve(root, "frontend/src/layouts/sidebarConfig.js"),
    "utf8"
  );
  const messagesSource = await readFile(
    path.resolve(root, "frontend/src/i18n/messages.js"),
    "utf8"
  );

  const implementedRoutes = parseImplementedRoutes(appSource);
  assert(
    implementedRoutes.length > 0,
    "No implemented routes parsed from App.jsx for RS-WIRE-02 guard"
  );

  const routesToGuard = implementedRoutes.filter(
    (route) =>
      route.componentName !== "Navigate" &&
      route.componentName !== "LegacyRouteRedirect" &&
      !route.appPath.includes(":")
  );
  assert(
    routesToGuard.length > 0,
    "No canonical implemented routes resolved for RS-WIRE-02 guard"
  );

  const missingSidebar = [];
  const missingI18n = [];
  for (const route of routesToGuard) {
    const navPath = route.permissionPath || route.appPath;
    if (!sidebarSource.includes(`to: "${navPath}"`)) {
      missingSidebar.push(route.appPath);
    }
    const i18nOccurrences = (messagesSource.match(new RegExp(`"${navPath}":`, "g")) || [])
      .length;
    if (i18nOccurrences < 2) {
      missingI18n.push(route.appPath);
    }
  }

  assert(
    missingSidebar.length === 0,
    `RS-WIRE-02 failed: missing sidebarConfig.js entries for routes: ${missingSidebar.join(", ")}`
  );
  assert(
    missingI18n.length === 0,
    `RS-WIRE-02 failed: missing TR/EN messages.sidebar.byPath labels for routes: ${missingI18n.join(", ")}`
  );

  console.log(
    `RS-WIRE-02 CI guard passed (${routesToGuard.length} canonical implemented routes have sidebar + i18n wiring).`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

