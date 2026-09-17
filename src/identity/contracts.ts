export type AgentStatus = "ACTIVE" | "REVOKED";

export type AgentIdentity = {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  status: AgentStatus;
  keyPrefix: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
};

export type StoredAgentIdentity = AgentIdentity & {
  keyHash: string;
};

export interface AgentIdentityRepository {
  readonly name: string;
  createAgent(record: StoredAgentIdentity): Promise<AgentIdentity>;
  getAgentById(id: string): Promise<AgentIdentity | null>;
  getAgentByKeyHash(keyHash: string): Promise<AgentIdentity | null>;
  updateLastSeen(id: string, lastSeenAt: string): Promise<void>;
  rotateKey(id: string, keyHash: string, keyPrefix: string, updatedAt: string): Promise<AgentIdentity | null>;
  revokeAgent(id: string, updatedAt: string): Promise<AgentIdentity | null>;
  close(): Promise<void>;
}
