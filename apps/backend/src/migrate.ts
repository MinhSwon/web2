import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "./db";

export async function migrate() {
  const candidates = [
    path.resolve(process.cwd(), "apps/backend/migrations"),
    path.resolve(process.cwd(), "migrations"),
  ];
  let migrationDir: string | undefined;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      migrationDir = candidate;
      break;
    } catch {
      // Try the next runtime layout.
    }
  }
  if (!migrationDir) throw new Error("Migration directory not found");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await fs.readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const exists = await pool.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [file]);
    if (exists.rowCount) continue;
    const sql = await fs.readFile(path.join(migrationDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

