import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { runCaseSchema } from "../cases/contracts.js";
import type { AgentAuth } from "../identity/auth.js";
import { resolveAgent } from "../identity/register-routes.js";
import type { CaseRepository } from "../storage/contracts.js";
import type { CourtJobRecord, CourtJobRepository } from "./contracts.js";

const idSchema = z.object({ id: z.string().trim().min(1) });
function invalid(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: "INVALID_JOB_REQUEST", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
}

export function registerJobRoutes(app: FastifyInstance, options: {
  jobs: CourtJobRepository;
  cases: CaseRepository;
  auth: AgentAuth;
  maxAttempts?: number | undefined;
  now?: (() => Date) | undefined;
  idFactory?: (() => string) | undefined;
  wakeWorker?: (() => void) | undefined;
}) {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;

  app.post("/v1/cases/:id/jobs", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth); if (agent === undefined) return; if (!agent) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const params = idSchema.safeParse(request.params); if (!params.success) return invalid(reply, params.error);
    const body = runCaseSchema.safeParse(request.body ?? {}); if (!body.success) return invalid(reply, body.error);
    const caseRecord = await options.cases.getCase(params.data.id, agent.id);
    if (!caseRecord) return reply.code(404).send({ error: "CASE_NOT_FOUND" });
    const rawKey = request.headers["idempotency-key"];
    const idempotencyKey = typeof rawKey === "string" && rawKey.trim() ? rawKey.trim().slice(0, 200) : null;
    if (idempotencyKey) {
      const existing = await options.jobs.getByIdempotencyKey(agent.id, idempotencyKey);
      if (existing) return reply.code(200).header("location", "/v1/jobs/" + existing.id).send(existing);
    }
    const timestamp = now().toISOString();
    const job: CourtJobRecord = {
      id: idFactory(), agentId: agent.id, caseId: caseRecord.id, runId: null,
      idempotencyKey, refreshEvidence: body.data.refreshEvidence,
      status: "QUEUED", stage: "QUEUED", attemptCount: 0, maxAttempts: options.maxAttempts ?? 3,
      generation: 0, leaseOwner: null, leaseExpiresAt: null, error: null,
      createdAt: timestamp, updatedAt: timestamp, completedAt: null,
    };
    const created = await options.jobs.createJob(job);
    options.wakeWorker?.();
    return reply.code(202).header("location", "/v1/jobs/" + created.id).send(created);
  });

  app.get("/v1/jobs/:id", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth); if (agent === undefined) return; if (!agent) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const params = idSchema.safeParse(request.params); if (!params.success) return invalid(reply, params.error);
    const job = await options.jobs.getJob(params.data.id, agent.id);
    return job ?? reply.code(404).send({ error: "JOB_NOT_FOUND" });
  });

  app.post("/v1/jobs/:id/cancel", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth); if (agent === undefined) return; if (!agent) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const params = idSchema.safeParse(request.params); if (!params.success) return invalid(reply, params.error);
    const job = await options.jobs.cancelQueuedJob(params.data.id, agent.id, now().toISOString());
    if (job) return job;
    const current = await options.jobs.getJob(params.data.id, agent.id);
    return current
      ? reply.code(409).send({ error: "JOB_ALREADY_STARTED", status: current.status })
      : reply.code(404).send({ error: "JOB_NOT_FOUND" });
  });
}
