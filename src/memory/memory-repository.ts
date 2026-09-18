import type {
  AgentCheckpoint,
  AgentMemoryRepository,
  Impression,
  StrategyVersion,
} from "./contracts.js";

const clone = <T>(value: T): T => structuredClone(value);

export function createMemoryAgentMemoryRepository(): AgentMemoryRepository {
  const strategies = new Map<string, StrategyVersion>();
  const impressions = new Map<string, Impression>();
  const checkpoints = new Map<string, AgentCheckpoint>();

  return {
    name: "memory",

    async createStrategy(record) {
      const siblings = [...strategies.values()].filter((item) =>
        item.agentId === record.agentId && item.asset === record.asset
      );
      if (record.parentVersionId) {
        const parent = strategies.get(record.parentVersionId);
        if (!parent || parent.agentId !== record.agentId) throw new Error("PARENT_STRATEGY_NOT_FOUND");
      }
      const version = Math.max(0, ...siblings.map((item) => item.version)) + 1;
      for (const sibling of siblings) {
        if (sibling.status === "ACTIVE") {
          strategies.set(sibling.id, { ...sibling, status: "SUPERSEDED", supersededAt: record.createdAt });
        }
      }
      const strategy: StrategyVersion = {
        ...clone(record),
        version,
        status: "ACTIVE",
        supersededAt: null,
      };
      strategies.set(strategy.id, strategy);
      return clone(strategy);
    },

    async listStrategies(agentId, limit) {
      return [...strategies.values()]
        .filter((item) => item.agentId === agentId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
        .map(clone);
    },

    async getStrategy(id, agentId) {
      const strategy = strategies.get(id);
      return strategy?.agentId === agentId ? clone(strategy) : null;
    },

    async createImpression(record) {
      if (record.strategyVersionId) {
        const strategy = strategies.get(record.strategyVersionId);
        if (!strategy || strategy.agentId !== record.agentId) throw new Error("STRATEGY_NOT_FOUND");
      }
      const impression: Impression = { ...clone(record), status: "ACTIVE", supersededAt: null };
      impressions.set(impression.id, impression);
      return clone(impression);
    },

    async recallImpressions(agentId, asset, limit, now) {
      return [...impressions.values()]
        .filter((item) => item.agentId === agentId && item.asset === asset)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
        .map((item) => ({ ...clone(item), isExpired: Boolean(item.validUntil && item.validUntil <= now) }));
    },

    async createCheckpoint(record) {
      if (record.strategyVersionId) {
        const strategy = strategies.get(record.strategyVersionId);
        if (!strategy || strategy.agentId !== record.agentId) throw new Error("STRATEGY_NOT_FOUND");
      }
      checkpoints.set(record.id, clone(record));
      return clone(record);
    },

    async getLatestCheckpoint(agentId, strategyVersionId) {
      const record = [...checkpoints.values()]
        .filter((item) => item.agentId === agentId && (
          strategyVersionId === undefined || item.strategyVersionId === strategyVersionId
        ))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      return record ? clone(record) : null;
    },

    async close() {},
  };
}
