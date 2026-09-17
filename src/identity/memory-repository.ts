import type { AgentIdentity, AgentIdentityRepository, StoredAgentIdentity } from "./contracts.js";

function publicIdentity(record: StoredAgentIdentity): AgentIdentity {
  const { keyHash: _keyHash, ...identity } = record;
  return structuredClone(identity);
}

export function createMemoryAgentIdentityRepository(): AgentIdentityRepository {
  const agents = new Map<string, StoredAgentIdentity>();

  return {
    name: "memory",

    async createAgent(record) {
      if (agents.has(record.id)) throw new Error("Agent already exists: " + record.id);
      agents.set(record.id, structuredClone(record));
      return publicIdentity(record);
    },

    async getAgentById(id) {
      const record = agents.get(id);
      return record ? publicIdentity(record) : null;
    },

    async getAgentByKeyHash(keyHash) {
      const record = [...agents.values()].find((entry) => entry.keyHash === keyHash);
      return record ? publicIdentity(record) : null;
    },

    async updateLastSeen(id, lastSeenAt) {
      const record = agents.get(id);
      if (record) agents.set(id, { ...record, lastSeenAt });
    },

    async rotateKey(id, keyHash, keyPrefix, updatedAt) {
      const record = agents.get(id);
      if (!record || record.status !== "ACTIVE") return null;
      const next = { ...record, keyHash, keyPrefix, updatedAt };
      agents.set(id, next);
      return publicIdentity(next);
    },

    async revokeAgent(id, updatedAt) {
      const record = agents.get(id);
      if (!record) return null;
      const next: StoredAgentIdentity = { ...record, status: "REVOKED", updatedAt };
      agents.set(id, next);
      return publicIdentity(next);
    },

    async close() {},
  };
}
