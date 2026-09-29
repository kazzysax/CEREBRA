import type { AgentMemoryRepository } from "../memory/contracts.js";

// The agent's own saved beliefs, handed to the court as context. They are the
// agent's claims, never evidence: the court tests them against the measured
// data and says when the data contradicts them. Expired impressions stay
// visible but are marked stale so an outdated belief cannot pass as current.
export type RememberedBelief = {
  statement: string;
  confidence: number;
  recordedAt: string;
  validUntil: string | null;
  freshness: "FRESH" | "EXPIRED" | "UNDATED";
  ageHours: number;
};

export type AgentMemory = {
  strategy: {
    version: number;
    timeframe: string;
    thesis: string;
    constraints: string[];
    invalidationConditions: string[];
    recordedAt: string;
    ageHours: number;
  } | null;
  beliefs: RememberedBelief[];
  fresh: number;
  stale: number;
};

// Agents save "TSLA" or "TSLAUSDT"; cases always use the futures symbol.
export function assetAliases(asset: string): string[] {
  const symbol = asset.trim().toUpperCase();
  const base = symbol.replace(/USDT$/, "");
  return [...new Set([symbol, base, base + "USDT"])].filter((alias) => alias.length >= 2);
}

function hoursSince(iso: string, now: Date): number {
  return Math.max(0, Math.round(((now.getTime() - new Date(iso).getTime()) / 3_600_000) * 10) / 10);
}

export async function loadAgentMemory(options: {
  memory: AgentMemoryRepository;
  agentId: string;
  asset: string;
  now: Date;
  limit?: number | undefined;
}): Promise<AgentMemory | null> {
  const aliases = assetAliases(options.asset);
  const nowIso = options.now.toISOString();
  const [strategies, ...recalled] = await Promise.all([
    options.memory.listStrategies(options.agentId, 50),
    ...aliases.map((alias) => options.memory.recallImpressions(options.agentId, alias, options.limit ?? 8, nowIso)),
  ]);
  const strategy = strategies
    .filter((item) => item.status === "ACTIVE" && aliases.includes(item.asset))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  const beliefs = recalled.flat()
    .filter((item) => item.status === "ACTIVE")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, options.limit ?? 8)
    .map((item): RememberedBelief => ({
      statement: item.statement,
      confidence: item.confidence,
      recordedAt: item.createdAt,
      validUntil: item.validUntil,
      freshness: item.validUntil === null ? "UNDATED" : item.isExpired ? "EXPIRED" : "FRESH",
      ageHours: hoursSince(item.createdAt, options.now),
    }));
  if (!strategy && beliefs.length === 0) return null;
  return {
    strategy: strategy
      ? {
        version: strategy.version,
        timeframe: strategy.timeframe,
        thesis: strategy.thesis,
        constraints: strategy.constraints,
        invalidationConditions: strategy.invalidationConditions,
        recordedAt: strategy.createdAt,
        ageHours: hoursSince(strategy.createdAt, options.now),
      }
      : null,
    beliefs,
    fresh: beliefs.filter((belief) => belief.freshness === "FRESH").length,
    stale: beliefs.filter((belief) => belief.freshness === "EXPIRED").length,
  };
}
