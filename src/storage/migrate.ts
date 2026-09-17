import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to run migrations");

const ssl = process.env.DATABASE_SSL === "true"
  ? { rejectUnauthorized: false }
  : undefined;
const pool = new Pool({ connectionString, ssl });

try {
  const sql = await readFile(
    new URL("../../migrations/001_initial.sql", import.meta.url),
    "utf8",
  );
  await pool.query(sql);
  console.log("Cerebra database migration completed.");
} finally {
  await pool.end();
}
