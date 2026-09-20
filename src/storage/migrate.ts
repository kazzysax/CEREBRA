import "dotenv/config";
import { runMigrations } from "./run-migrations.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to run migrations");

await runMigrations({
  connectionString,
  ssl: process.env.DATABASE_SSL === "true",
});