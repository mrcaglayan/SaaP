import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { __testOnboardingInternals } from "../src/routes/onboarding.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function byCode(rows, code) {
  return rows.find((row) => String(row?.code || "") === String(code || ""));
}

async function main() {
  const normalize = __testOnboardingInternals?.normalizeOnboardingDefaultAccounts;
  assert(
    typeof normalize === "function",
    "Missing normalizeOnboardingDefaultAccounts test export"
  );

  const fallbackRows = normalize(undefined);
  assert(Array.isArray(fallbackRows) && fallbackRows.length > 0, "Default fallback rows missing");

  const flatCamelRows = normalize([
    {
      code: "1000",
      name: "Cash",
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: true,
    },
    {
      code: "2000",
      name: "Accounts Payable",
      accountType: "LIABILITY",
      normalSide: "CREDIT",
      allowPosting: false,
    },
  ]);
  assert(flatCamelRows.length === 2, "Flat camelCase payload should normalize");
  assert(flatCamelRows.every((row) => row.parentCode === null), "Flat payload must not require parentCode");
  assert(
    byCode(flatCamelRows, "2000")?.allowPosting === false,
    "allowPosting=false should be preserved for flat payload"
  );

  const flatSnakeRows = normalize([
    {
      code: "1100",
      name: "Accounts Receivable",
      account_type: "ASSET",
      normal_side: "DEBIT",
      allow_posting: 1,
    },
    {
      code: "3000",
      name: "Retained Earnings",
      account_type: "EQUITY",
      normal_side: "CREDIT",
      allow_posting: 0,
    },
  ]);
  assert(flatSnakeRows.length === 2, "Flat snake_case payload should normalize");
  assert(
    byCode(flatSnakeRows, "3000")?.allowPosting === false,
    "allow_posting=0 should map to allowPosting=false"
  );

  const treeRows = normalize([
    {
      code: "1000",
      name: "Assets",
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: true,
    },
    {
      code: "1020",
      name: "Banks",
      accountType: "ASSET",
      normalSide: "DEBIT",
      allowPosting: true,
      parentCode: "1000",
    },
  ]);
  const parentIndex = treeRows.findIndex((row) => row.code === "1000");
  const childIndex = treeRows.findIndex((row) => row.code === "1020");
  assert(parentIndex !== -1 && childIndex !== -1, "Tree rows should include parent and child");
  assert(parentIndex < childIndex, "Tree rows should resolve in deterministic parent-first order");

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const onboardingRouteSource = await readFile(
    path.resolve(root, "backend/src/routes/onboarding.js"),
    "utf8"
  );
  assert(
    onboardingRouteSource.includes("entity.defaultAccounts ?? entity.default_accounts"),
    "Missing backward-compat support for entity.default_accounts"
  );

  console.log("PR-F02 onboarding defaultAccounts backward-compat test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

