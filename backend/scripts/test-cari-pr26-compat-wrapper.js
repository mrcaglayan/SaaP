import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const targetScript = path.join(
  currentDir,
  "test-cari-pr19-counterparty-account-mapping-and-posting-resolution.js"
);

console.log(
  [
    "[repo-hygiene] test:cari-pr26 is an explicit compatibility alias.",
    "Implemented PR-26 counterparty enrichment coverage remains hosted in the broader PR19-era script:",
    "scripts/test-cari-pr19-counterparty-account-mapping-and-posting-resolution.js",
  ].join(" ")
);

const result = spawnSync(process.execPath, [targetScript], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
