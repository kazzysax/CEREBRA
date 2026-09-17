import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AgentIdentity, AgentIdentityRepository } from "./contracts.js";

export const registerAgentSchema = z.object({
  name: z.string().trim().min(2).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/),
  description: z.string().trim().max(500).default(""),
  capabilities: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
}).strict();

export class AgentAuthError extends Error {
  readonly code: "UNAUTHORIZED" | "REGISTRATION_FORBIDDEN";

  constructor(code: AgentAuthError["code"], message: string) {
    super(message);
    this.name = "AgentAuthError";
    this.code = code;
  }
}

function safeSecretEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function createAgentAuth(options: {
  repository: AgentIdentityRepository;
  mode: "open" | "agent-key";
  apiKeyPepper: string;
  registrationToken?: string | undefined;
  now?: (() => Date) | undefined;
  idFactory?: (() => string) | undefined;
}) {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;

  function hashKey(apiKey: string): string {
    return createHmac("sha256", options.apiKeyPepper).update(apiKey).digest("hex");
  }

  function issueKey() {
    const apiKey = "cba_live_" + randomBytes(32).toString("base64url");
    return {
      apiKey,
      keyHash: hashKey(apiKey),
      keyPrefix: apiKey.slice(0, 17),
    };
  }

  async function authenticate(authorization: string | undefined): Promise<AgentIdentity | null> {
    if (!authorization) {
      if (options.mode === "open") return null;
      throw new AgentAuthError("UNAUTHORIZED", "A Cerebra agent bearer key is required.");
    }
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (!match?.[1]) throw new AgentAuthError("UNAUTHORIZED", "Authorization must use a Bearer token.");
    const agent = await options.repository.getAgentByKeyHash(hashKey(match[1]));
    if (!agent || agent.status !== "ACTIVE") {
      throw new AgentAuthError("UNAUTHORIZED", "The agent key is invalid, rotated, or revoked.");
    }
    const lastSeenAt = now().toISOString();
    await options.repository.updateLastSeen(agent.id, lastSeenAt);
    return { ...agent, lastSeenAt };
  }

  return {
    mode: options.mode,

    async register(input: unknown, presentedRegistrationToken?: string) {
      if (options.registrationToken && (
        !presentedRegistrationToken ||
        !safeSecretEqual(presentedRegistrationToken, options.registrationToken)
      )) {
        throw new AgentAuthError("REGISTRATION_FORBIDDEN", "A valid registration token is required.");
      }
      const parsed = registerAgentSchema.parse(input);
      const issued = issueKey();
      const timestamp = now().toISOString();
      const agent = await options.repository.createAgent({
        id: idFactory(),
        name: parsed.name,
        description: parsed.description,
        capabilities: [...new Set(parsed.capabilities)],
        status: "ACTIVE",
        keyHash: issued.keyHash,
        keyPrefix: issued.keyPrefix,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastSeenAt: null,
      });
      return { agent, apiKey: issued.apiKey };
    },

    authenticate,

    async rotate(agentId: string) {
      const issued = issueKey();
      const agent = await options.repository.rotateKey(
        agentId,
        issued.keyHash,
        issued.keyPrefix,
        now().toISOString(),
      );
      if (!agent) throw new AgentAuthError("UNAUTHORIZED", "The agent is not active.");
      return { agent, apiKey: issued.apiKey };
    },

    async revoke(agentId: string) {
      return options.repository.revokeAgent(agentId, now().toISOString());
    },
  };
}

export type AgentAuth = ReturnType<typeof createAgentAuth>;
