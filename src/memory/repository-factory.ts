import type { StorageConfig } from "../storage/repository-factory.js";
import type { AgentMemoryRepository } from "./contracts.js";
import { createMemoryAgentMemoryRepository } from "./memory-repository.js";
import { createPostgresAgentMemoryRepository } from "./postgres-repository.js";

export function createConfiguredAgentMemoryRepository(config: StorageConfig): AgentMemoryRepository {
  if (config.driver === "memory") return createMemoryAgentMemoryRepository();
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required when STORAGE_DRIVER=postgres");
  return createPostgresAgentMemoryRepository({ connectionString: config.databaseUrl, ssl: config.databaseSsl });
}
