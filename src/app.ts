import { createMcpFastifyApp } from "@modelcontextprotocol/fastify";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { caseSubmissionSchema, type CourtModelProvider } from "./agents/contracts.js";
import { createMockCourtProvider } from "./agents/mock-provider.js";
import { runCourt } from "./court/run-court.js";
import { registerCaseRoutes } from "./cases/register-routes.js";
import type { EvidenceProvider } from "./evidence/contracts.js";
import { createMockEvidenceProvider } from "./evidence/mock-evidence-provider.js";
import { createCerebraMcpServer } from "./mcp/create-server.js";
import type { CaseRepository } from "./storage/contracts.js";
import { createMemoryCaseRepository } from "./storage/memory-repository.js";
import { createAgentAuth } from "./identity/auth.js";
import type { AgentIdentityRepository } from "./identity/contracts.js";
import { createMemoryAgentIdentityRepository } from "./identity/memory-repository.js";
import { registerAgentRoutes, resolveAgent } from "./identity/register-routes.js";
import { withAgentIdentity } from "./identity/context.js";
import type { AgentMemoryRepository } from "./memory/contracts.js";
import { createMemoryAgentMemoryRepository } from "./memory/memory-repository.js";
import { registerMemoryRoutes } from "./memory/register-routes.js";
import type { CourtJobRepository } from "./jobs/contracts.js";
import { createMemoryCourtJobRepository } from "./jobs/memory-repository.js";
import { registerJobRoutes } from "./jobs/register-routes.js";
import { createCourtJobWorker } from "./jobs/worker.js";
import { registerOutcomeRoutes } from "./outcomes/register-routes.js";
import { createAnonymousRateLimit } from "./security/anonymous-rate-limit.js";

export async function buildApp(options: {
  host?: string | undefined;
  allowedHosts?: string[] | undefined;
  courtProvider?: CourtModelProvider | undefined;
  evidenceProvider?: EvidenceProvider | undefined;
  repository?: CaseRepository | undefined;
  identityRepository?: AgentIdentityRepository | undefined;
  memoryRepository?: AgentMemoryRepository | undefined;
  jobRepository?: CourtJobRepository | undefined;
  jobs?: {
    enabled: boolean;
    pollIntervalMs?: number | undefined;
    leaseMs?: number | undefined;
    maxAttempts?: number | undefined;
  } | undefined;
  anonymousRateLimit?: {
    windowMs?: number | undefined;
    maxRequests?: number | undefined;
    now?: (() => number) | undefined;
  } | undefined;
  auth?: {
    mode: "open" | "agent-key";
    apiKeyPepper: string;
    registrationToken?: string | undefined;
  } | undefined;
} = {}) {
  const allowAnyHost = options.allowedHosts?.includes("*") ?? false;
  const host = options.host ?? "127.0.0.1";
  const app = await createMcpFastifyApp(allowAnyHost
    ? { host }
    : { host, allowedHosts: options.allowedHosts ?? ["127.0.0.1", "localhost"] });
  const courtProvider = options.courtProvider ?? createMockCourtProvider();
  const evidenceProvider = options.evidenceProvider ?? createMockEvidenceProvider();
  const repository = options.repository ?? createMemoryCaseRepository();
  const identityRepository = options.identityRepository ?? createMemoryAgentIdentityRepository();
  const memoryRepository = options.memoryRepository ?? createMemoryAgentMemoryRepository();
  const jobRepository = options.jobRepository ?? createMemoryCourtJobRepository();
  const auth = createAgentAuth({
    repository: identityRepository,
    mode: options.auth?.mode ?? "open",
    apiKeyPepper: options.auth?.apiKeyPepper ?? "development-only-cerebra-key-pepper",
    registrationToken: options.auth?.registrationToken,
  });
  const mcpHandler = createMcpHandler(() => createCerebraMcpServer({
    repository,
    evidenceProvider,
    courtProvider,
    jobs: jobRepository,
    memory: memoryRepository,
    maxJobAttempts: options.jobs?.maxAttempts,
  }));
  const nodeHandler = toNodeHandler(mcpHandler);
  const jobWorker = createCourtJobWorker({
    jobs: jobRepository,
    cases: repository,
    evidenceProvider,
    courtProvider,
    pollIntervalMs: options.jobs?.pollIntervalMs,
    leaseMs: options.jobs?.leaseMs,
  });

  app.addHook("onClose", async () => {
    await jobWorker.stop();
    await Promise.all([repository.close(), identityRepository.close(), memoryRepository.close(), jobRepository.close()]);
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => ({ status: "ready" }));
  app.get("/v1/meta", async () => ({
    name: "cerebra",
    version: "0.6.0",
    courtProvider: {
      name: courtProvider.name,
      model: courtProvider.model,
    },
    evidenceProvider: evidenceProvider.name,
    storage: repository.name,
    memory: memoryRepository.name,
    jobs: { storage: jobRepository.name, workerEnabled: options.jobs?.enabled ?? false },
    agentAuth: auth.mode,
    topology: {
      researchers: ["analyst", "challenger"],
      judges: ["judge-risk", "judge-evidence", "judge-strategy"],
      votingRule: "equal-weight simple majority",
    },
  }));
  registerAgentRoutes(app, auth);
  registerCaseRoutes(app, { repository, evidenceProvider, courtProvider, auth, anonymousRateLimit: createAnonymousRateLimit(options.anonymousRateLimit) });
  registerMemoryRoutes(app, { repository: memoryRepository, auth });
  registerJobRoutes(app, {
    jobs: jobRepository,
    cases: repository,
    auth,
    maxAttempts: options.jobs?.maxAttempts,
  });
  registerOutcomeRoutes(app, { repository, auth });
  app.post("/v1/court/runs", async (request, reply) => {
    const agent = await resolveAgent(request, reply, auth);
    if (agent === undefined) return;
    const submission = caseSubmissionSchema.safeParse(request.body);
    if (!submission.success) {
      return reply.code(400).send({
        error: "INVALID_CASE_SUBMISSION",
        issues: submission.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    try {
      const result = await runCourt(submission.data, courtProvider);
      return reply.code(201).send(result);
    } catch (error) {
      request.log.error({ error }, "court run failed");
      return reply.code(502).send({
        error: "COURT_RUN_FAILED",
        message: error instanceof Error ? error.message : "Unknown court run failure",
      });
    }
  });
  app.all("/mcp", async (request, reply) => {
    const agent = await resolveAgent(request, reply, auth);
    if (agent === undefined) return;
    await withAgentIdentity(agent, () => nodeHandler(
      request.raw as Parameters<typeof nodeHandler>[0],
      reply.raw,
      request.body,
    ));
  });

  if (options.jobs?.enabled) jobWorker.start();

  return app;
}
