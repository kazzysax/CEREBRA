import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AgentAuth } from "../identity/auth.js";
import { resolveAgent } from "../identity/register-routes.js";
import {
  createCheckpointSchema,
  createImpressionSchema,
  createStrategyVersionSchema,
  type AgentMemoryRepository,
} from "./contracts.js";

const limitSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const idSchema = z.object({ id: z.string().trim().min(1) });
const recallSchema = limitSchema.extend({ asset: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase()) });
const checkpointQuerySchema = z.object({ strategyVersionId: z.string().trim().min(1).optional() });

function invalid(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: "INVALID_MEMORY_REQUEST", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
}

export function registerMemoryRoutes(app: FastifyInstance, options: {
  repository: AgentMemoryRepository;
  auth: AgentAuth;
  now?: (() => Date) | undefined;
  idFactory?: (() => string) | undefined;
}) {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;

  app.post("/v1/memory/strategies", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth); if (agent === undefined) return; if (!agent) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const parsed = createStrategyVersionSchema.safeParse(request.body); if (!parsed.success) return invalid(reply, parsed.error);
    try {
      return reply.code(201).send(await options.repository.createStrategy({
        id: idFactory(), agentId: agent.id, ...parsed.data, createdAt: now().toISOString(),
      }));
    } catch (error) {
      if (error instanceof Error && error.message === "PARENT_STRATEGY_NOT_FOUND") return reply.code(404).send({ error: error.message });
      throw error;
    }
  });

  app.get("/v1/memory/strategies", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth); if (agent === undefined) return; if (!agent) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const parsed = limitSchema.safeParse(request.query); if (!parsed.success) return invalid(reply, parsed.error);
    return { strategies: await options.repository.listStrategies(agent.id, parsed.data.limit) };
  });

  app.get("/v1/memory/strategies/:id", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth); if (agent === undefined) return; if (!agent) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const parsed = idSchema.safeParse(request.params); if (!parsed.success) return invalid(reply, parsed.error);
    const strategy = await options.repository.getStrategy(parsed.data.id, agent.id);
    return strategy ?? reply.code(404).send({ error: "STRATEGY_NOT_FOUND" });
  });

  app.post("/v1/memory/impressions", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth); if (agent === undefined) return; if (!agent) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const parsed = createImpressionSchema.safeParse(request.body); if (!parsed.success) return invalid(reply, parsed.error);
    try {
      return reply.code(201).send(await options.repository.createImpression({
        id: idFactory(), agentId: agent.id, ...parsed.data, createdAt: now().toISOString(),
      }));
    } catch (error) {
      if (error instanceof Error && error.message === "STRATEGY_NOT_FOUND") return reply.code(404).send({ error: error.message });
      throw error;
    }
  });

  app.get("/v1/memory/recall", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth); if (agent === undefined) return; if (!agent) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const parsed = recallSchema.safeParse(request.query); if (!parsed.success) return invalid(reply, parsed.error);
    return { impressions: await options.repository.recallImpressions(agent.id, parsed.data.asset, parsed.data.limit, now().toISOString()) };
  });

  app.post("/v1/memory/checkpoints", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth); if (agent === undefined) return; if (!agent) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const parsed = createCheckpointSchema.safeParse(request.body); if (!parsed.success) return invalid(reply, parsed.error);
    try {
      return reply.code(201).send(await options.repository.createCheckpoint({
        id: idFactory(), agentId: agent.id, ...parsed.data, createdAt: now().toISOString(),
      }));
    } catch (error) {
      if (error instanceof Error && error.message === "STRATEGY_NOT_FOUND") return reply.code(404).send({ error: error.message });
      throw error;
    }
  });

  app.get("/v1/memory/checkpoints/latest", async (request, reply) => {
    const agent = await resolveAgent(request, reply, options.auth); if (!agent) return;
    const parsed = checkpointQuerySchema.safeParse(request.query); if (!parsed.success) return invalid(reply, parsed.error);
    const checkpoint = await options.repository.getLatestCheckpoint(agent.id, parsed.data.strategyVersionId);
    return checkpoint ?? reply.code(404).send({ error: "CHECKPOINT_NOT_FOUND" });
  });
}
