import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";

export async function runMigrations(options: {
  connectionString: string;
  ssl: boolean;
}): Promise<void> {
  const pool = new Pool({
    connectionString: options.connectionString,
    ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const directory = new URL("../../migrations/", import.meta.url);
    const migrations = (await readdir(directory))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort();
    for (const migration of migrations) {
      const sql = await readFile(new URL(migration, directory), "utf8");
      await pool.query(sql);
      console.log("Applied migration: " + migration);
    }
    console.log("Cerebra database migrations completed.");
  } finally {
    await pool.end();
  }
}