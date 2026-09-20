import "dotenv/config";
import { buildApp } from "./app.js";
import { createConfiguredCourtProvider } from "./agents/provider-factory.js";
import { loadConfig } from "./config.js";
import { createBitgetEvidenceProvider } from "./evidence/bitget-evidence-provider.js";
import { createMockEvidenceProvider } from "./evidence/mock-evidence-provider.js";
import { createConfiguredCaseRepository } from "./storage/repository-factory.js";
import { createConfiguredAgentIdentityRepository } from "./identity/repository-factory.js";
import { createConfiguredAgentMemoryRepository } from "./memory/repository-factory.js";
import { createConfiguredCourtJobRepository } from "./jobs/repository-factory.js";
import { runMigrations } from "./storage/run-migrations.js";

const config = loadConfig();
if (config.storage.driver === "postgres") {
  await runMigrations({
    connectionString: config.storage.databaseUrl!,
    ssl: config.storage.databaseSsl,
  });
}
const courtProvider = createConfiguredCourtProvider(config.ai);
const evidenceProvider = config.evidenceProvider === "bitget"
  ? createBitgetEvidenceProvider()
  : createMockEvidenceProvider();
const repository = createConfiguredCaseRepository(config.storage);
const identityRepository = createConfiguredAgentIdentityRepository(config.storage);
const memoryRepository = createConfiguredAgentMemoryRepository(config.storage);
const jobRepository = createConfiguredCourtJobRepository(config.storage);
const app = await buildApp({
  host: config.host,
  allowedHosts: config.allowedHosts,
  courtProvider,
  evidenceProvider,
  repository,
  identityRepository,
  memoryRepository,
  jobRepository,
  auth: config.auth,
  jobs: config.jobs,
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.host, port: config.port });
