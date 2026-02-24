import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCounterpartyPayload,
  buildInitialCounterpartyForm,
  mapDetailToCounterpartyForm,
  resolveCounterpartyAccountPickerGates,
} from "../../frontend/src/pages/cari/counterpartyFormUtils.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function countOccurrences(source, literal) {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "g");
  return (source.match(pattern) || []).length;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const pageSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/CariCounterpartyPage.jsx"),
    "utf8"
  );
  const formSource = await readFile(
    path.resolve(root, "frontend/src/pages/cari/CounterpartyForm.jsx"),
    "utf8"
  );
  const apiSource = await readFile(
    path.resolve(root, "frontend/src/api/cariCounterparty.js"),
    "utf8"
  );
  const messagesSource = await readFile(path.resolve(root, "frontend/src/i18n/messages.js"), "utf8");

  assert(
    pageSource.includes("resolveCounterpartyAccountPickerGates"),
    "CariCounterpartyPage should consume account picker gating helper"
  );
  assert(
    pageSource.includes("listAccounts"),
    "CariCounterpartyPage should fetch GL accounts through listAccounts()"
  );
  assert(
    pageSource.includes("!parsedLegalEntityId || !accountPickerGates.shouldFetchGlAccounts"),
    "GL account fetch must be gated before dispatch"
  );
  assert(
    pageSource.includes("canReadGlAccounts={accountPickerGates.showAccountPickers}"),
    "Counterparty form should receive GL picker visibility gate"
  );

  assert(
    formSource.includes("AR Control Account Override"),
    "Counterparty form should render AR override selector"
  );
  assert(
    formSource.includes("AP Control Account Override"),
    "Counterparty form should render AP override selector"
  );
  assert(
    formSource.includes("Missing permission: gl.account.read"),
    "Counterparty form should provide controlled fallback when GL account read is missing"
  );

  assert(
    apiSource.includes("normalizeCounterpartyPayload"),
    "Counterparty API client should normalize payload for optional account mappings"
  );
  assert(
    apiSource.includes("delete normalized.arAccountId") &&
      apiSource.includes("delete normalized.apAccountId"),
    "Counterparty API client should avoid sending undefined AR/AP fields"
  );

  const noReadGates = resolveCounterpartyAccountPickerGates([]);
  assert(noReadGates.canReadGlAccounts === false, "No permissions should hide GL account picker");
  assert(
    noReadGates.shouldFetchGlAccounts === false,
    "No permissions should block GL account fetches"
  );
  const readGates = resolveCounterpartyAccountPickerGates(["gl.account.read"]);
  assert(readGates.canReadGlAccounts === true, "gl.account.read should enable GL account picker");
  assert(
    readGates.shouldFetchGlAccounts === true,
    "gl.account.read should allow GL account fetches"
  );

  const initialForm = buildInitialCounterpartyForm("CUSTOMER");
  assert(Object.prototype.hasOwnProperty.call(initialForm, "arAccountId"), "Initial form should have arAccountId");
  assert(Object.prototype.hasOwnProperty.call(initialForm, "apAccountId"), "Initial form should have apAccountId");

  const mappedForm = mapDetailToCounterpartyForm({
    legalEntityId: 11,
    code: "CP-PR19",
    name: "PR19 Counterparty",
    isCustomer: true,
    isVendor: true,
    arAccountId: 123,
    apAccountId: 456,
    contacts: [],
    addresses: [],
  });
  assert(mappedForm.arAccountId === "123", "Detail mapper should preserve arAccountId");
  assert(mappedForm.apAccountId === "456", "Detail mapper should preserve apAccountId");

  const payload = buildCounterpartyPayload({
    ...initialForm,
    legalEntityId: "11",
    code: "CP19PAYLOAD",
    name: "PR19 Payload",
    isCustomer: true,
    isVendor: true,
    arAccountId: "101",
    apAccountId: "202",
    contacts: [],
    addresses: [],
  });
  assert(payload.arAccountId === 101, "Payload builder should output numeric arAccountId");
  assert(payload.apAccountId === 202, "Payload builder should output numeric apAccountId");

  assert(
    countOccurrences(messagesSource, "accountPickerPermissionMissing") >= 2,
    "messages.js should contain accountPickerPermissionMissing in tr/en"
  );
  assert(
    countOccurrences(messagesSource, "arAccountLabel") >= 2,
    "messages.js should contain arAccountLabel in tr/en"
  );
  assert(
    countOccurrences(messagesSource, "apAccountLabel") >= 2,
    "messages.js should contain apAccountLabel in tr/en"
  );

  console.log("PR19 frontend counterparty account fields smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
