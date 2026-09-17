import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AgentAuthError, type AgentAuth } from "./auth.js";
import type { AgentIdentity } from "./contracts.js";

export async function resolveAgent(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AgentAuth,
): Promise<AgentIdentity | null | undefined> {
  try {
    return await auth.authenticate(request.headers.authorization);
  } catch (error) {
    if (error instanceof AgentAuthError) {
      reply.code(401).send({ error: error.code, message: error.message });
      return undefined;
    }
    throw error;
  }
}

export function registerAgentRoutes(app: FastifyInstance, auth: AgentAuth) {
  app.post("/v1/agents/register", async (request, reply) => {
    try {
      const result = await auth.register(
        request.body,
        typeof request.headers["x-cerebra-registration-token"] === "string"
          ? request.headers["x-cerebra-registration-token"]
          : undefined,
      );
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof AgentAuthError) {
        return reply.code(403).send({ error: error.code, message: error.message });
      }
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "INVALID_AGENT_REGISTRATION",
          issues: error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        });
      }
      throw error;
    }
  });

  app.get("/v1/agents/me", async (request, reply) => {
    const agent = await resolveAgent(request, reply, auth);
    if (agent === undefined) return;
    if (!agent) return reply.code(401).send({
      error: "UNAUTHORIZED",
      message: "Agent authentication is disabled in open development mode.",
    });
    return agent;
  });

  app.post("/v1/agents/me/keys/rotate", async (request, reply) => {
    const agent = await resolveAgent(request, reply, auth);
    if (agent === undefined) return;
    if (!agent) return reply.code(401).send({ error: "UNAUTHORIZED" });
    return reply.code(201).send(await auth.rotate(agent.id));
  });

  app.post("/v1/agents/me/revoke", async (request, reply) => {
    const agent = await resolveAgent(request, reply, auth);
    if (agent === undefined) return;
    if (!agent) return reply.code(401).send({ error: "UNAUTHORIZED" });
    const revoked = await auth.revoke(agent.id);
    return revoked ?? reply.code(404).send({ error: "AGENT_NOT_FOUND" });
  });
}
