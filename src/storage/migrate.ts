import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to run migrations");

const ssl = process.env.DATABASE_SSL === "true"
  ? { rejectUnauthorized: false }
  : undefined;
const pool = new Pool({ connectionString, ssl });

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
