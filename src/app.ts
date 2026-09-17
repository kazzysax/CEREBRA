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

export async function buildApp(options: {
  allowedHosts?: string[] | undefined;
  courtProvider?: CourtModelProvider | undefined;
  evidenceProvider?: EvidenceProvider | undefined;
  repository?: CaseRepository | undefined;
} = {}) {
  const app = await createMcpFastifyApp({
    allowedHosts: options.allowedHosts ?? ["127.0.0.1", "localhost"],
  });
  const courtProvider = options.courtProvider ?? createMockCourtProvider();
  const evidenceProvider = options.evidenceProvider ?? createMockEvidenceProvider();
  const repository = options.repository ?? createMemoryCaseRepository();
  const mcpHandler = createMcpHandler(createCerebraMcpServer);
  const nodeHandler = toNodeHandler(mcpHandler);

  app.addHook("onClose", async () => repository.close());

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => ({ status: "ready" }));
  app.get("/v1/meta", async () => ({
    name: "cerebra",
    version: "0.4.0",
    courtProvider: {
      name: courtProvider.name,
      model: courtProvider.model,
    },
    evidenceProvider: evidenceProvider.name,
    storage: repository.name,
    topology: {
      researchers: ["analyst", "challenger"],
      judges: ["judge-risk", "judge-evidence", "judge-strategy"],
      votingRule: "equal-weight simple majority",
    },
  }));
  registerCaseRoutes(app, { repository, evidenceProvider, courtProvider });
  app.post("/v1/court/runs", async (request, reply) => {
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
    await nodeHandler(
      request.raw as Parameters<typeof nodeHandler>[0],
      reply.raw,
      request.body,
    );
  });

  return app;
}
