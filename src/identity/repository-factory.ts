import type { StorageConfig } from "../storage/repository-factory.js";
import type { AgentIdentityRepository } from "./contracts.js";
import { createMemoryAgentIdentityRepository } from "./memory-repository.js";
import { createPostgresAgentIdentityRepository } from "./postgres-repository.js";

export function createConfiguredAgentIdentityRepository(config: StorageConfig): AgentIdentityRepository {
  if (config.driver === "memory") return createMemoryAgentIdentityRepository();
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required when STORAGE_DRIVER=postgres");
  }
  return createPostgresAgentIdentityRepository({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl,
  });
}
