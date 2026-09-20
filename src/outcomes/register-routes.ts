import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AgentAuth } from "../identity/auth.js";
import { resolveAgent } from "../identity/register-routes.js";
import type { CaseRepository } from "../storage/contracts.js";
import { createOutcomeSchema } from "./contracts.js";

const idSchema = z.object({ id: z.string().trim().min(1) });
function invalid(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: "INVALID_OUTCOME", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
}

export function registerOutcomeRoutes(app: FastifyInstance, options: { repository: CaseRepository; auth: AgentAuth; now?: (() => Date) | undefined }) {
  const now = options.now ?? (() => new Date());
  app.post("/v1/runs/:id/outcomes", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth); if (agent === undefined) return; if (!agent) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const params = idSchema.safeParse(request.params); const body = createOutcomeSchema.safeParse(request.body);
    if (!params.success) return invalid(reply, params.error); if (!body.success) return invalid(reply, body.error);
    if (!await options.repository.getRun(params.data.id, agent.id)) return reply.code(404).send({ error: "RUN_NOT_FOUND" });
    return reply.code(201).send(await options.repository.saveOutcome({ id: randomUUID(), runId: params.data.id, agentId: agent.id, ...body.data, recordedAt: now().toISOString() }));
  });
  app.get("/v1/runs/:id/outcomes", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth); if (agent === undefined) return; if (!agent) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const params = idSchema.safeParse(request.params); if (!params.success) return invalid(reply, params.error);
    return { outcomes: await options.repository.listOutcomes(params.data.id, agent.id) };
  });
  app.get("/v1/judges/calibration", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth); if (agent === undefined) return; if (!agent) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return { judges: await options.repository.getJudgeCalibration(agent.id) };
  });
}
