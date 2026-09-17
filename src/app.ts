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

export async function buildApp(options: {
  host?: string | undefined;
  allowedHosts?: string[] | undefined;
  courtProvider?: CourtModelProvider | undefined;
  evidenceProvider?: EvidenceProvider | undefined;
  repository?: CaseRepository | undefined;
  identityRepository?: AgentIdentityRepository | undefined;
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
  }));
  const nodeHandler = toNodeHandler(mcpHandler);

  app.addHook("onClose", async () => {
    await Promise.all([repository.close(), identityRepository.close()]);
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => ({ status: "ready" }));
  app.get("/v1/meta", async () => ({
    name: "cerebra",
    version: "0.5.0",
    courtProvider: {
      name: courtProvider.name,
      model: courtProvider.model,
    },
    evidenceProvider: evidenceProvider.name,
    storage: repository.name,
    agentAuth: auth.mode,
    topology: {
      researchers: ["analyst", "challenger"],
      judges: ["judge-risk", "judge-evidence", "judge-strategy"],
      votingRule: "equal-weight simple majority",
    },
  }));
  registerAgentRoutes(app, auth);
  registerCaseRoutes(app, { repository, evidenceProvider, courtProvider, auth });
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

  return app;
}
