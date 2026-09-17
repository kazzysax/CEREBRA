import "dotenv/config";
import { buildApp } from "./app.js";
import { createConfiguredCourtProvider } from "./agents/provider-factory.js";
import { loadConfig } from "./config.js";
import { createBitgetEvidenceProvider } from "./evidence/bitget-evidence-provider.js";
import { createMockEvidenceProvider } from "./evidence/mock-evidence-provider.js";
import { createConfiguredCaseRepository } from "./storage/repository-factory.js";

const config = loadConfig();
const courtProvider = createConfiguredCourtProvider(config.ai);
const evidenceProvider = config.evidenceProvider === "bitget"
  ? createBitgetEvidenceProvider()
  : createMockEvidenceProvider();
const repository = createConfiguredCaseRepository(config.storage);
const app = await buildApp({
  allowedHosts: config.allowedHosts,
  courtProvider,
  evidenceProvider,
  repository,
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.host, port: config.port });
