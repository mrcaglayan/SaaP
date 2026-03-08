import path from "node:path";
import { fileURLToPath } from "node:url";
import SwaggerParser from "@apidevtools/swagger-parser";

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const openapiPath = path.resolve(scriptDir, "..", "openapi.yaml");
  const api = await SwaggerParser.validate(openapiPath);
  const version = api?.info?.version ? ` v${api.info.version}` : "";
  const title = api?.info?.title || "OpenAPI";
  console.log(`openapi validate ok: ${title}${version}`);
}

main().catch((error) => {
  console.error("openapi validate failed");
  console.error(error?.message || error);
  process.exitCode = 1;
});
