import { z } from "zod";

export const createStrategyVersionSchema = z.object({
  asset: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase()),
  timeframe: z.string().trim().min(1).max(30),
  thesis: z.string().trim().min(10).max(4_000),
  constraints: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  invalidationConditions: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  parentVersionId: z.string().trim().min(1).nullable().default(null),
}).strict();

export const createImpressionSchema = z.object({
  strategyVersionId: z.string().trim().min(1).nullable().default(null),
  asset: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase()),
  statement: z.string().trim().min(5).max(2_000),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  validUntil: z.string().datetime().nullable().default(null),
}).strict();

export const createCheckpointSchema = z.object({
  strategyVersionId: z.string().trim().min(1).nullable().default(null),
  schemaVersion: z.string().trim().min(1).max(80).default("cerebra-agent-state.v1"),
  state: z.record(z.string(), z.unknown()),
  lastAcknowledgedActionId: z.string().trim().min(1).max(200).nullable().default(null),
  reconciliationRequired: z.boolean().default(true),
}).strict();

export type StrategyVersion = {
  id: string;
  agentId: string;
  asset: string;
  timeframe: string;
  thesis: string;
  constraints: string[];
  invalidationConditions: string[];
  parentVersionId: string | null;
  version: number;
  status: "ACTIVE" | "SUPERSEDED";
  createdAt: string;
  supersededAt: string | null;
};

export type Impression = {
  id: string;
  agentId: string;
  strategyVersionId: string | null;
  asset: string;
  statement: string;
  confidence: number;
  evidenceIds: string[];
  validUntil: string | null;
  status: "ACTIVE" | "SUPERSEDED";
  createdAt: string;
  supersededAt: string | null;
};

export type RecalledImpression = Impression & { isExpired: boolean };

export type AgentCheckpoint = {
  id: string;
  agentId: string;
  strategyVersionId: string | null;
  schemaVersion: string;
  state: Record<string, unknown>;
  lastAcknowledgedActionId: string | null;
  reconciliationRequired: boolean;
  createdAt: string;
};

export interface AgentMemoryRepository {
  readonly name: string;
  createStrategy(record: Omit<StrategyVersion, "version" | "status" | "supersededAt">): Promise<StrategyVersion>;
  listStrategies(agentId: string, limit: number): Promise<StrategyVersion[]>;
  getStrategy(id: string, agentId: string): Promise<StrategyVersion | null>;
  createImpression(record: Omit<Impression, "status" | "supersededAt">): Promise<Impression>;
  recallImpressions(agentId: string, asset: string, limit: number, now: string): Promise<RecalledImpression[]>;
  createCheckpoint(record: AgentCheckpoint): Promise<AgentCheckpoint>;
  getLatestCheckpoint(agentId: string, strategyVersionId?: string | null): Promise<AgentCheckpoint | null>;
  close(): Promise<void>;
}
