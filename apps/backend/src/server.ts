import { createApp, closeAppResources } from "./app";
import { config } from "./config";
import { pool } from "./db";
import { migrate } from "./migrate";
import { closeQueue } from "./queue";
import { initializeStorage } from "./storage";

async function retry<T>(name: string, fn: () => Promise<T>, attempts = 30): Promise<T> {
  let lastError: unknown;
  for (let index = 1; index <= attempts; index++) {
    try { return await fn(); } catch (error) {
      lastError = error;
      console.log(`${name} chưa sẵn sàng (${index}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}

async function main() {
  await retry("PostgreSQL", migrate);
  await retry("Object storage", initializeStorage);
  const app = createApp();
  const server = app.listen(config.PORT, () => console.log(`Backend listening on :${config.PORT}`));
  const shutdown = async () => {
    server.close();
    await Promise.allSettled([closeAppResources(), closeQueue(), pool.end()]);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

