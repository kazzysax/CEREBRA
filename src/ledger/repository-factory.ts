import type { StorageConfig } from "../storage/repository-factory.js";
import type { LedgerRepository } from "./contracts.js";
import { createMemoryLedgerRepository } from "./memory-repository.js";
import { createPostgresLedgerRepository } from "./postgres-repository.js";

export function createConfiguredLedgerRepository(config: StorageConfig): LedgerRepository {
  if (config.driver === "memory") return createMemoryLedgerRepository();
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required when STORAGE_DRIVER=postgres");
  return createPostgresLedgerRepository({ connectionString: config.databaseUrl, ssl: config.databaseSsl });
}
