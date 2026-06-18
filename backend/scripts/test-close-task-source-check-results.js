import { runCloseTaskPrctm09Check } from "./lib/close-task-prctm09-checks.js";

runCloseTaskPrctm09Check("source-checks").catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
