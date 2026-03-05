import { readFile } from "node:fs/promises";
import path from "node:path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readUtf8(relativePathFromBackend) {
  const absolutePath = path.resolve(process.cwd(), relativePathFromBackend);
  return readFile(absolutePath, "utf8");
}

async function main() {
  const trackerSource = await readUtf8(
    "../PR-STEPS/18-CARI-MULTI-CURRENCY-SETTLEMENTS-ROLLOUT-UAT.md"
  );
  const packageJsonSource = await readUtf8("package.json");

  const requiredTrackerTokens = [
    "PR-MCSR05",
    "GA readiness signoff and closure",
    "Engineering",
    "Finance/Accounting owner",
    "Operations",
    "GA signoff record",
  ];
  for (const token of requiredTrackerTokens) {
    assert(
      trackerSource.includes(token),
      `Rollout tracker must include GA token: ${token}`
    );
  }

  const requiredScripts = [
    '"test:cari:mcsr01"',
    '"test:cari:mcsr02"',
    '"test:cari:mcsr03"',
    '"test:cari:mcsr04"',
    '"test:cari:mcsr05"',
    '"test:cari:mcsr"',
    '"test:cari:mcsr-release-gate"',
  ];
  for (const scriptToken of requiredScripts) {
    assert(
      packageJsonSource.includes(scriptToken),
      `package.json must include script ${scriptToken}`
    );
  }

  console.log("CARI MCSR05 GA signoff gate smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
