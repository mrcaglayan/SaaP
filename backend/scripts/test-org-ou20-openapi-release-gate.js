import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runCommand(command, args, cwd, label = command, useShell = false) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env },
      stdio: "inherit",
      shell: useShell,
    });

    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function runNpmScript(scriptName, cwd) {
  if (process.platform === "win32") {
    await runCommand(
      "cmd.exe",
      ["/d", "/s", "/c", `npm run ${scriptName}`],
      cwd,
      `npm run ${scriptName}`
    );
    return;
  }
  await runCommand("npm", ["run", scriptName], cwd, `npm run ${scriptName}`);
}

function findOperation(spec, routePath, method) {
  return spec?.paths?.[routePath]?.[method] || null;
}

function assertTaggedExplicitOperation(spec, routePath, method, expectedTag) {
  const operation = findOperation(spec, routePath, method);
  assert(operation, `OpenAPI path missing: ${method.toUpperCase()} ${routePath}`);

  const tags = Array.isArray(operation.tags) ? operation.tags : [];
  assert(
    tags.includes(expectedTag),
    `OpenAPI operation must be tagged ${expectedTag}: ${method.toUpperCase()} ${routePath}`
  );
  assert(
    !String(operation.summary || "").startsWith("Auto-generated:"),
    `OpenAPI operation must have explicit summary: ${method.toUpperCase()} ${routePath}`
  );
}

function requireSchema(spec, schemaName) {
  const schema = spec?.components?.schemas?.[schemaName] || null;
  assert(schema, `OpenAPI schema missing: ${schemaName}`);
  return schema;
}

function assertSchemaProperty(schema, propertyName, message) {
  assert(
    schema?.properties && Object.prototype.hasOwnProperty.call(schema.properties, propertyName),
    message
  );
}

function getRequestBodyRef(operation) {
  return (
    operation?.requestBody?.content?.["application/json"]?.schema?.$ref || null
  );
}

function getResponseRef(operation, statusCode = "200") {
  return (
    operation?.responses?.[statusCode]?.content?.["application/json"]?.schema?.$ref || null
  );
}

function assertPackageScripts(packageSource) {
  const pkg = JSON.parse(packageSource);
  const scripts = pkg?.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};

  const requiredScripts = [
    "test:cash-register-ownership",
    "test:cash-register-ownership:cro06",
    "test:cash-register-ownership:cro07",
    "test:cash-register-ownership:rollout",
    "test:org:ou14-current-account-config",
    "test:org:ou15-current-account-apply",
    "test:org:ou16-bootstrap-current-account",
    "test:org:ou17-branch-delta",
    "test:org:ou18-current-account-ux",
    "test:org:ou19-current-account-readiness",
    "test:org:ou20-openapi-release-gate",
    "test:ou:current-account-automation:release-gate",
  ];
  for (const scriptName of requiredScripts) {
    assert(typeof scripts[scriptName] === "string", `package.json script missing: ${scriptName}`);
  }

  const ouAggregate = String(scripts["test:ou:current-account-automation:release-gate"] || "");
  for (const scriptName of [
    "test:org:ou14-current-account-config",
    "test:org:ou15-current-account-apply",
    "test:org:ou16-bootstrap-current-account",
    "test:org:ou17-branch-delta",
    "test:org:ou18-current-account-ux",
    "test:org:ou19-current-account-readiness",
    "test:org:ou20-openapi-release-gate",
  ]) {
    assert(
      ouAggregate.includes(scriptName),
      `OU current-account aggregate gate must include ${scriptName}`
    );
  }

  assert(
    String(scripts["test:release-gate:core"] || "").includes(
      "test:ou:current-account-automation:release-gate"
    ),
    "Core release gate must include test:ou:current-account-automation:release-gate"
  );
}

function assertOpenApi(spec) {
  for (const [routePath, method] of [
    ["/api/v1/org/operating-unit-current-account-config", "get"],
    ["/api/v1/org/operating-unit-current-account-config", "post"],
    ["/api/v1/org/operating-unit-current-account-config/apply", "post"],
  ]) {
    assertTaggedExplicitOperation(spec, routePath, method, "Org");
  }

  for (const [routePath, method] of [
    ["/api/v1/onboarding/company-bootstrap", "post"],
    ["/api/v1/onboarding/company-bootstrap/current-account-eligibility-preview", "post"],
    ["/api/v1/onboarding/readiness", "get"],
    ["/api/v1/onboarding/module-readiness", "get"],
  ]) {
    assertTaggedExplicitOperation(spec, routePath, method, "Onboarding");
  }

  const bootstrapOperation = findOperation(spec, "/api/v1/onboarding/company-bootstrap", "post");
  assert(
    getRequestBodyRef(bootstrapOperation) ===
      "#/components/schemas/OnboardingCompanyBootstrapInput",
    "Company bootstrap request body must use OnboardingCompanyBootstrapInput"
  );
  assert(
    getResponseRef(bootstrapOperation, "201") ===
      "#/components/schemas/OnboardingCompanyBootstrapResponse",
    "Company bootstrap response must use OnboardingCompanyBootstrapResponse"
  );

  const previewOperation = findOperation(
    spec,
    "/api/v1/onboarding/company-bootstrap/current-account-eligibility-preview",
    "post"
  );
  assert(
    getRequestBodyRef(previewOperation) ===
      "#/components/schemas/OnboardingCompanyBootstrapCurrentAccountEligibilityPreviewInput",
    "Current-account eligibility preview request must use the explicit preview schema"
  );
  assert(
    getResponseRef(previewOperation, "200") ===
      "#/components/schemas/OnboardingCompanyBootstrapCurrentAccountEligibilityPreviewResponse",
    "Current-account eligibility preview response must use the explicit preview schema"
  );

  const moduleReadinessOperation = findOperation(
    spec,
    "/api/v1/onboarding/module-readiness",
    "get"
  );
  assert(
    getResponseRef(moduleReadinessOperation, "200") ===
      "#/components/schemas/ModuleReadinessResponse",
    "Module readiness response must use ModuleReadinessResponse"
  );

  const tenantReadinessCheck = requireSchema(spec, "TenantReadinessCheck");
  const tenantReadinessCounts = requireSchema(spec, "TenantReadinessCounts");
  const bootstrapConfigInput = requireSchema(
    spec,
    "OnboardingCompanyBootstrapCurrentAccountConfigInput"
  );
  const bootstrapResponse = requireSchema(spec, "OnboardingCompanyBootstrapResponse");
  const moduleReadinessResponse = requireSchema(spec, "ModuleReadinessResponse");
  const readinessRow = requireSchema(spec, "OperatingUnitCurrentAccountReadinessRow");
  const configRow = requireSchema(spec, "OperatingUnitCurrentAccountConfigRow");
  requireSchema(spec, "OperatingUnitCurrentAccountConfigApplyInput");
  requireSchema(spec, "OperatingUnitCurrentAccountApplyResponse");
  requireSchema(spec, "TenantReadinessOperatingUnitCurrentAccountDetails");
  requireSchema(spec, "OnboardingCompanyBootstrapCurrentAccountEligibilityPreviewResponse");

  assertSchemaProperty(
    tenantReadinessCheck,
    "details",
    "TenantReadinessCheck must expose details"
  );
  for (const propertyName of [
    "openBookPeriods",
    "shareholders",
    "shareholderCommitmentConfigs",
    "operatingUnitCurrentAccounts",
    "workflowCloseConsolidationV1",
  ]) {
    assertSchemaProperty(
      tenantReadinessCounts,
      propertyName,
      `TenantReadinessCounts must expose ${propertyName}`
    );
  }

  for (const propertyName of [
    "dueFromParentAccountCode",
    "dueToParentAccountCode",
    "skipForNow",
  ]) {
    assertSchemaProperty(
      bootstrapConfigInput,
      propertyName,
      `Onboarding bootstrap current-account config must expose ${propertyName}`
    );
  }

  assertSchemaProperty(
    bootstrapResponse,
    "currentAccountReadinessWarnings",
    "Onboarding bootstrap response must expose currentAccountReadinessWarnings"
  );

  assertSchemaProperty(
    moduleReadinessResponse.properties?.modules,
    "operatingUnitCurrentAccounts",
    "Module readiness response must expose operatingUnitCurrentAccounts"
  );

  for (const propertyName of [
    "blockerCode",
    "configChangedSinceLastApply",
    "missingCentralOperatingUnits",
    "missingPartnerDirections",
    "setupPath",
  ]) {
    assertSchemaProperty(
      readinessRow,
      propertyName,
      `OperatingUnitCurrentAccountReadinessRow must expose ${propertyName}`
    );
  }

  assertSchemaProperty(
    configRow,
    "updated_at",
    "OperatingUnitCurrentAccountConfigRow must expose updated_at"
  );
}

function assertRunbooks(ouRunbookSource, cariRunbookSource) {
  const normalizedOuRunbook = String(ouRunbookSource || "").toLowerCase();
  const normalizedCariRunbook = String(cariRunbookSource || "").toLowerCase();

  for (const phrase of [
    "choose parent control accounts once",
    "system creates or reuses branch-specific children automatically",
    "only delta is created",
    "old branches are not reset",
    "saved config missing",
    "saved config exists but apply not run",
    "saved config exists but mapping drift remains",
    "manual organization management edit remains available for exceptions",
  ]) {
    assert(
      normalizedOuRunbook.includes(phrase),
      `OU rollout runbook must mention: ${phrase}`
    );
  }

  for (const phrase of [
    "saved config missing",
    "apply not run",
    "mapping drift remains",
    "organization management",
  ]) {
    assert(
      normalizedCariRunbook.includes(phrase),
      `Cari runbook must mention: ${phrase}`
    );
  }
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(backendRoot, "..");
  const openapiPath = path.resolve(backendRoot, "openapi.yaml");
  const openapiSourceBeforeGenerate = await readFile(openapiPath, "utf8");

  await runNpmScript("openapi:generate", backendRoot);
  const openapiSourceAfterGenerate = await readFile(openapiPath, "utf8");
  assert(
    openapiSourceBeforeGenerate === openapiSourceAfterGenerate,
    "OpenAPI drift detected: regenerate backend/openapi.yaml and re-run the release gate"
  );
  await runNpmScript("check:openapi:parse", backendRoot);
  await runNpmScript("check:openapi", backendRoot);

  const [openapiSource, packageSource, ouRunbookSource, cariRunbookSource] =
    await Promise.all([
      readFile(path.resolve(backendRoot, "openapi.yaml"), "utf8"),
      readFile(path.resolve(backendRoot, "package.json"), "utf8"),
      readFile(
        path.resolve(repoRoot, "docs/runbooks/ou-self-balancing-transfers-and-settlements.md"),
        "utf8"
      ),
      readFile(path.resolve(repoRoot, "docs/runbooks/cari-v1-operations.md"), "utf8"),
    ]);

  const spec = parseYaml(openapiSource);
  assertPackageScripts(packageSource);
  assertOpenApi(spec);
  assertRunbooks(ouRunbookSource, cariRunbookSource);

  console.log("OU current-account automation OpenAPI/release gate passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
