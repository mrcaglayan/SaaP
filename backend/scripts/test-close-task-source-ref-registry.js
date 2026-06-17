import assert from "node:assert/strict";
import {
  CLOSE_TASK_INSTANCE as BACKEND_CLOSE_TASK_INSTANCE,
  LOCAL_CLOSE_PACK as BACKEND_LOCAL_CLOSE_PACK,
  SOURCE_REF_TYPES as BACKEND_SOURCE_REF_TYPES,
} from "../src/utils/source-ref-types.js";
import {
  CLOSE_TASK_INSTANCE as FRONTEND_CLOSE_TASK_INSTANCE,
  LOCAL_CLOSE_PACK as FRONTEND_LOCAL_CLOSE_PACK,
  SOURCE_REF_TYPES as FRONTEND_SOURCE_REF_TYPES,
} from "../../frontend/src/utils/sourceRefTypes.js";

async function main() {
  assert.equal(BACKEND_CLOSE_TASK_INSTANCE, "CLOSE_TASK_INSTANCE");
  assert.equal(BACKEND_LOCAL_CLOSE_PACK, "LOCAL_CLOSE_PACK");
  assert(BACKEND_SOURCE_REF_TYPES.has(BACKEND_CLOSE_TASK_INSTANCE));
  assert(BACKEND_SOURCE_REF_TYPES.has(BACKEND_LOCAL_CLOSE_PACK));

  assert.equal(FRONTEND_CLOSE_TASK_INSTANCE, "CLOSE_TASK_INSTANCE");
  assert.equal(FRONTEND_LOCAL_CLOSE_PACK, "LOCAL_CLOSE_PACK");
  assert(FRONTEND_SOURCE_REF_TYPES.has(FRONTEND_CLOSE_TASK_INSTANCE));
  assert(FRONTEND_SOURCE_REF_TYPES.has(FRONTEND_LOCAL_CLOSE_PACK));

  console.log("test-close-task-source-ref-registry passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
