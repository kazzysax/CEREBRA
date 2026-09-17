import type { CaseRepository } from "./contracts.js";
import { createMemoryCaseRepository } from "./memory-repository.js";
import { createPostgresCaseRepository } from "./postgres-repository.js";

export type StorageConfig = {
  driver: "memory" | "postgres";
  databaseUrl?: string | undefined;
  databaseSsl: boolean;
};

export function createConfiguredCaseRepository(config: StorageConfig): CaseRepository {
  if (config.driver === "memory") return createMemoryCaseRepository();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_DRIVER=postgres");
  }
  return createPostgresCaseRepository({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl,
  });
}
