import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { caseSubmissionSchema, type CourtModelProvider } from "../agents/contracts.js";
import { runCourt } from "../court/run-court.js";
import { renderRulingMarkdown } from "../domain/report-renderer.js";
import type { EvidenceProvider } from "../evidence/contracts.js";
import type { CaseRepository } from "../storage/contracts.js";
import type { AgentAuth } from "../identity/auth.js";
import { resolveAgent } from "../identity/register-routes.js";
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

    let record = await options.repository.getCase(params.data.id, agent?.id ?? null);
    if (!record) return reply.code(404).send({ error: "CASE_NOT_FOUND" });
    const runId = idFactory();
    let runCreated = false;

    try {
      if (record.evidenceMode === "BITGET" && body.data.refreshEvidence) {
        const evidence = await options.evidenceProvider.collect(record.submission.proposal);
        record = await options.repository.replaceEvidence(
          record.id,
          evidence,
          now().toISOString(),
        );
        if (!record) throw new Error("Case disappeared during evidence refresh");
      }

      const startedAt = now().toISOString();
      await options.repository.setCaseStatus(record.id, "RUNNING", startedAt);
      await options.repository.createRun({
        id: runId,
        caseId: record.id,
        status: "RUNNING",
        provider: options.courtProvider.name,
        model: options.courtProvider.model,
        startedAt,
        completedAt: null,
        result: null,
        error: null,
      });
      runCreated = true;

      const result = await runCourt(record.submission, options.courtProvider, {
        idFactory: () => runId,
      });
      const markdown = renderRulingMarkdown(result.report);
      await options.repository.completeRun(runId, result, markdown);
      return reply.code(201).send(result);
    } catch (error) {
      request.log.error({ error }, "case court run failed");
      const message = error instanceof Error ? error.message : "Unknown court run failure";
      if (runCreated) {
        try {
          await options.repository.failRun(runId, message, now().toISOString());
        } catch (persistenceError) {
          request.log.error({ persistenceError }, "failed to persist court run failure");
        }
      }
      return reply.code(502).send({ error: "COURT_RUN_FAILED", message, runId });
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
