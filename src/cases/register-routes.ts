import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { caseSubmissionSchema, type CourtModelProvider } from "../agents/contracts.js";
import type { EvidenceProvider } from "../evidence/contracts.js";
import type { CaseRepository } from "../storage/contracts.js";
import type { AgentAuth } from "../identity/auth.js";
import { resolveAgent } from "../identity/register-routes.js";
import { CaseExecutionError, executeCase } from "./execute-case.js";
import {
  createCaseSchema,
  idParamsSchema,
  listCasesQuerySchema,
  runCaseSchema,
} from "./contracts.js";

type CaseRouteOptions = {
  repository: CaseRepository;
  evidenceProvider: EvidenceProvider;
  courtProvider: CourtModelProvider;
  auth: AgentAuth;
  now?: (() => Date) | undefined;
  idFactory?: (() => string) | undefined;
};

function validationError(reply: FastifyReply, code: string, error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return reply.code(400).send({
    error: code,
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  });
}

export function registerCaseRoutes(app: FastifyInstance, options: CaseRouteOptions) {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;

  app.post("/v1/cases", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth);
    if (agent === undefined) return;
    const parsed = createCaseSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, "INVALID_CASE", parsed.error);

    try {
      const caseId = idFactory();
      const proposal = {
        ...parsed.data.proposal,
        id: parsed.data.proposal.id ?? "proposal-" + caseId,
      };
      const evidence = parsed.data.evidenceMode === "BITGET"
        ? await options.evidenceProvider.collect(proposal)
        : parsed.data.evidence;
      const submission = caseSubmissionSchema.parse({
        proposal,
        riskLevel: parsed.data.riskLevel,
        evidence,
      });
      const timestamp = now().toISOString();
      const record = await options.repository.createCase({
        id: caseId,
        agentId: agent?.id ?? null,
        submission,
        evidenceMode: parsed.data.evidenceMode,
        status: "READY",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return reply.code(201).send(record);
    } catch (error) {
      request.log.error({ error }, "case creation failed");
      return reply.code(502).send({
        error: "CASE_CREATION_FAILED",
        message: error instanceof Error ? error.message : "Unknown case creation failure",
      });
    }
  });

  app.get("/v1/cases", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth);
    if (agent === undefined) return;
    const query = listCasesQuerySchema.safeParse(request.query);
    if (!query.success) return validationError(reply, "INVALID_QUERY", query.error);
    return { cases: await options.repository.listCases(query.data.limit, agent?.id ?? null) };
  });

  app.get("/v1/cases/:id", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth);
    if (agent === undefined) return;
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, "INVALID_CASE_ID", params.error);
    const record = await options.repository.getCase(params.data.id, agent?.id ?? null);
    if (!record) return reply.code(404).send({ error: "CASE_NOT_FOUND" });
    return record;
  });

  app.get("/v1/runs", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth);
    if (agent === undefined) return;
    const query = listCasesQuerySchema.safeParse(request.query);
    if (!query.success) return validationError(reply, "INVALID_QUERY", query.error);
    return { runs: await options.repository.listRuns(query.data.limit, agent?.id ?? null) };
  });

  app.post("/v1/cases/:id/evidence/refresh", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth);
    if (agent === undefined) return;
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, "INVALID_CASE_ID", params.error);
    const record = await options.repository.getCase(params.data.id, agent?.id ?? null);
    if (!record) return reply.code(404).send({ error: "CASE_NOT_FOUND" });
    if (record.evidenceMode !== "BITGET") {
      return reply.code(409).send({ error: "MANUAL_EVIDENCE_CANNOT_REFRESH" });
    }
    try {
      const evidence = await options.evidenceProvider.collect(record.submission.proposal);
      const updated = await options.repository.replaceEvidence(
        record.id,
        evidence,
        now().toISOString(),
      );
      return updated;
    } catch (error) {
      request.log.error({ error }, "evidence refresh failed");
      return reply.code(502).send({
        error: "EVIDENCE_REFRESH_FAILED",
        message: error instanceof Error ? error.message : "Unknown evidence refresh failure",
      });
    }
  });

  app.post("/v1/cases/:id/run", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth);
    if (agent === undefined) return;
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, "INVALID_CASE_ID", params.error);
    const body = runCaseSchema.safeParse(request.body ?? {});
    if (!body.success) return validationError(reply, "INVALID_RUN_REQUEST", body.error);

    try {
      const result = await executeCase({
        caseId: params.data.id,
        agentId: agent?.id ?? null,
        refreshEvidence: body.data.refreshEvidence,
        repository: options.repository,
        evidenceProvider: options.evidenceProvider,
        courtProvider: options.courtProvider,
        now,
        idFactory,
      });
      return reply.code(201).send(result);
    } catch (error) {
      request.log.error({ error }, "case court run failed");
      const message = error instanceof Error ? error.message : "Unknown court run failure";
      if (error instanceof CaseExecutionError && error.code === "CASE_NOT_FOUND") {
        return reply.code(404).send({ error: error.code });
      }
      return reply.code(502).send({ error: "COURT_RUN_FAILED", message, runId: error instanceof CaseExecutionError ? error.runId : undefined });
    }
  });

  app.get("/v1/runs/:id/report", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth);
    if (agent === undefined) return;
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, "INVALID_RUN_ID", params.error);
    const report = await options.repository.getReport(params.data.id, agent?.id ?? null);
    if (!report) return reply.code(404).send({ error: "REPORT_NOT_FOUND" });
    return report;
  });

  app.get("/v1/runs/:id", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth);
    if (agent === undefined) return;
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, "INVALID_RUN_ID", params.error);
    const run = await options.repository.getRun(params.data.id, agent?.id ?? null);
    if (!run) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    return run;
  });
}
