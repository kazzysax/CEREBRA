import type { StorageConfig } from "../storage/repository-factory.js";
import type { CourtJobRepository } from "./contracts.js";
import { createMemoryCourtJobRepository } from "./memory-repository.js";
import { createPostgresCourtJobRepository } from "./postgres-repository.js";

export function createConfiguredCourtJobRepository(config: StorageConfig): CourtJobRepository {
  if (config.driver === "memory") return createMemoryCourtJobRepository();
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required when STORAGE_DRIVER=postgres");
  return createPostgresCourtJobRepository({ connectionString: config.databaseUrl, ssl: config.databaseSsl });
}
