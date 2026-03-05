import { closePool } from "./db.js";
import { seedStarter } from "./seedStarter.js";

async function main() {
  const result = await seedStarter();
  console.log("Starter seed completed:", result);
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await closePool();
    process.exit(1);
  });
