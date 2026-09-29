// Replays market data captured from live Bitget cases through the current
// court with a real model, to check the court gives varied, data-bound rulings.
// Usage: QWEN_API_KEY=... QWEN_BASE_URL=... QWEN_MODEL=... tsx scripts/replay-eval.ts <dir-of-run-json> [out.json]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createQwenCourtProvider } from "../src/agents/qwen-provider.js";
import type { CaseSubmission } from "../src/agents/contracts.js";
import { runCourt } from "../src/court/run-court.js";
import type { EvidenceReference } from "../src/domain/contracts.js";
import { computeMarketFeatures, parseCandles, renderCandleTable, renderFeatureSummary } from "../src/evidence/market-features.js";

type Captured = { report: { evidence: EvidenceReference[]; proposal: { summary: string } } };

function rawOf(evidence: EvidenceReference[], action: string): unknown {
  const item = evidence.find((entry) => entry.id.startsWith("bitget:" + action + ":"));
  const text = (item?.summary ?? "").replace(/^Bitget \w+ response: /, "").replace(/\.\.\.\[truncated\]$/, "");
  return JSON.parse(text);
}

function rebuildEvidence(captured: EvidenceReference[]): { evidence: EvidenceReference[]; asset: string } {
  const sample = captured.find((entry) => entry.id.startsWith("bitget:tickers:"))!;
  const [, , asset, ...rest] = sample.id.split(":");
  const observedAt = rest.join(":");
  const ticker = rawOf(captured, "tickers");
  const orderbook = rawOf(captured, "orderbook");
  const candles = rawOf(captured, "candles");
  const features = computeMarketFeatures({ symbol: asset!, interval: "4H", observedAt, ticker, orderbook, candles });
  const raw = captured.map((entry) => entry.id.startsWith("bitget:candles:")
    ? { ...entry, summary: "Bitget candles for " + asset + ". " + renderCandleTable(parseCandles(candles)) }
    : entry);
  return {
    asset: asset!,
    evidence: [{
      id: "cerebra:features:" + asset + ":" + observedAt,
      title: asset + " measured market features",
      source: "cerebra-market-features",
      observedAt,
      digest: "sha256:replay",
      summary: renderFeatureSummary(features),
      metrics: features as unknown as Record<string, unknown>,
    }, ...raw],
  };
}

const directions = ["LONG", "SHORT", "EITHER"] as const;
const dir = process.argv[2]!;
const out = process.argv[3] ?? "replay-results.json";
const provider = createQwenCourtProvider({
  apiKey: process.env.QWEN_API_KEY!,
  baseURL: process.env.QWEN_BASE_URL!,
  model: process.env.QWEN_MODEL!,
  fallbackModels: (process.env.QWEN_FALLBACK_MODELS ?? "").split(",").map((model) => model.trim()).filter(Boolean),
  timeoutMs: 120_000,
  maxRetries: 1,
});

const seen = new Set<string>();
const jobs: Array<{ label: string; submission: CaseSubmission }> = [];
for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
  const captured = JSON.parse(readFileSync(join(dir, file), "utf8")) as Captured;
  if (!captured.report?.evidence?.some((entry) => entry.id.startsWith("bitget:tickers:"))) continue;
  const { evidence, asset } = rebuildEvidence(captured.report.evidence);
  if (seen.has(asset)) continue;
  seen.add(asset);
  for (const direction of directions) {
    jobs.push({
      label: asset + " " + direction,
      submission: {
        proposal: { asset, market: "usdt-futures", timeframe: "4h", direction, summary: captured.report.proposal.summary },
        riskLevel: "MEDIUM",
        evidence,
      },
    });
  }
}

// Optional filter, e.g. REPLAY_ONLY="TSLAUSDT EITHER,NVDAUSDT LONG", to spend few requests.
const only = process.env.REPLAY_ONLY?.split(",").map((label) => label.trim()).filter(Boolean);
if (only?.length) jobs.splice(0, jobs.length, ...jobs.filter((job) => only.includes(job.label)));

const results: unknown[] = [];
// Low concurrency: the OpenRouter key has a small credit ceiling for in-flight requests.
const concurrency = Number(process.env.REPLAY_CONCURRENCY ?? 2);
const queue = [...jobs];
await Promise.all(Array.from({ length: concurrency }, async () => {
  for (let job = queue.shift(); job; job = queue.shift()) await evaluate(job);
}));
writeFileSync(out, JSON.stringify(results, null, 2));

// A=approve R=reject B=abstain N=unavailable -=not asked
function letter(vote: string | null | undefined) {
  return vote === "APPROVE" ? "A" : vote === "REJECT" ? "R" : vote === "ABSTAIN" ? "B" : vote === null ? "-" : "N";
}

async function evaluate({ label, submission }: (typeof jobs)[number]) {
  const started = Date.now();
  try {
    const run = await runCourt(submission, provider);
    const features = submission.evidence[0]!.metrics as { candles?: { trend?: string }; depth?: { bias?: string } };
    const row = {
      label,
      trend: features.candles?.trend,
      depth: features.depth?.bias,
      analyst: run.analystCase.recommendation + "/" + run.analystCase.marketBias,
      plan: [run.analystCase.entryPrice, run.analystCase.stopPrice, run.analystCase.targetPrice],
      rr: run.riskCheck?.primary.rewardRisk ?? null,
      budget: run.riskCheck?.primary.withinRiskBudget ?? null,
      status: run.report.status,
      votes: run.report.judges.map((judge) => letter(judge.vote)).join(""),
      altVotes: run.report.judges.map((judge) => letter(judge.alternativeVote)).join(""),
      models: [...new Set(run.trace.map((entry) => entry.model))].join(","),
      confidences: run.report.judges.map((judge) => judge.confidence),
      advice: run.report.recommendation.status + " " + run.report.recommendation.direction + " (" + run.report.recommendation.source + ")",
      warnings: run.report.integrity.warnings?.length ?? 0,
      seconds: Math.round((Date.now() - started) / 1000),
    };
    results.push({ ...row, report: run.report, analystCase: run.analystCase });
    console.log(JSON.stringify(row));
  } catch (error) {
    results.push({ label, error: String(error) });
    console.log(JSON.stringify({ label, error: String(error).slice(0, 200) }));
  }
}
