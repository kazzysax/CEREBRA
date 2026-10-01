import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import type { AnalystCase, CaseSubmission } from "../src/agents/contracts.js";
import { createMockCourtProvider } from "../src/agents/mock-provider.js";
import { computeRiskCheck } from "../src/court/risk-check.js";
import { runCourt } from "../src/court/run-court.js";
import type { EvidenceProvider } from "../src/evidence/contracts.js";
import { computeMarketFeatures, type Candle } from "../src/evidence/market-features.js";
import { resolveDueOutcomes, resolvePath } from "../src/outcomes/auto-resolver.js";
import { createMemoryCaseRepository } from "../src/storage/memory-repository.js";
import { featureEvidence } from "./fixtures.js";

const registrationToken = "test-registration-token-that-is-long-enough";
const auth = { mode: "open" as const, apiKeyPepper: "test-agent-key-pepper-that-is-long-enough", registrationToken };

const manualCase = {
  proposal: { asset: "TSLAUSDT", market: "usdt-futures", timeframe: "4h", direction: "LONG", summary: "Privacy fixture: a private agent thesis." },
  riskLevel: "MEDIUM",
  evidenceMode: "MANUAL",
  evidence: featureEvidence({ trend: "UP" }),
};

test("anonymous callers cannot list or open agent-owned cases, runs or reports", async () => {
  const app = await buildApp({ auth });
  const registered = await app.inject({
    method: "POST", url: "/v1/agents/register",
    headers: { "x-cerebra-registration-token": registrationToken },
    payload: { name: "Private Agent" },
  });
  const key = registered.json().apiKey as string;
  const bearer = { authorization: "Bearer " + key };
  const created = await app.inject({ method: "POST", url: "/v1/cases", headers: bearer, payload: manualCase });
  const run = await app.inject({ method: "POST", url: "/v1/cases/" + created.json().id + "/run", headers: bearer, payload: { refreshEvidence: false } });
  const runId = run.json().runId as string;

  // The owner still sees everything.
  assert.equal((await app.inject({ method: "GET", url: "/v1/runs", headers: bearer })).json().runs.length, 1);
  assert.equal((await app.inject({ method: "GET", url: "/v1/runs/" + runId + "/report", headers: bearer })).statusCode, 200);

  // Anonymous callers see none of it (this leaked every agent's history in production).
  assert.deepEqual((await app.inject({ method: "GET", url: "/v1/runs" })).json().runs, []);
  assert.deepEqual((await app.inject({ method: "GET", url: "/v1/cases" })).json().cases, []);
  assert.equal((await app.inject({ method: "GET", url: "/v1/cases/" + created.json().id })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/v1/runs/" + runId })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/v1/runs/" + runId + "/report" })).statusCode, 404);
  await app.close();
});

test("anonymous portal cases stay visible to anonymous callers", async () => {
  const app = await buildApp({ auth });
  const created = await app.inject({ method: "POST", url: "/v1/cases", payload: manualCase });
  assert.equal(created.statusCode, 201);
  assert.equal((await app.inject({ method: "GET", url: "/v1/cases" })).json().cases.length, 1);
  await app.close();
});

test("spot cases are refused: tokenized stocks trade only as USDT futures", async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: "POST", url: "/v1/cases",
    payload: { ...manualCase, proposal: { ...manualCase.proposal, market: "spot" } },
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /usdt-futures/);
  await app.close();
});

test("market features classify trend and keep the newest bar", () => {
  const candles = Array.from({ length: 20 }, (_, index) => [1_790_000_000_000 + index * 3_600_000, 100 - index, 100.5 - index, 98.5 - index, 99 - index, 10]);
  const features = computeMarketFeatures({ symbol: "TSLAUSDT", interval: "1H", observedAt: "2026-09-29T00:00:00.000Z", ticker: [{ lastPrice: "80" }], orderbook: { b: [[79.9, 1]], a: [[80.1, 9]] }, candles });
  assert.equal(features.candles?.trend, "DOWN");
  assert.equal(features.candles?.count, 20);
  assert.equal(features.depth?.bias, "ASK_HEAVY");
  assert.equal(features.candles?.newestAt, new Date(1_790_000_000_000 + 19 * 3_600_000).toISOString());
});

test("risk check flags levels on the wrong side and budgets by risk posture", () => {
  const submission = {
    proposal: { asset: "TSLAUSDT", market: "usdt-futures", timeframe: "4h", direction: "LONG", summary: "Risk check fixture thesis." },
    riskLevel: "LOW",
    evidence: featureEvidence({ trend: "UP" }),
  } as CaseSubmission;
  const base: Omit<AnalystCase, "entryPrice" | "stopPrice" | "targetPrice"> = {
    recommendation: "APPROVE", marketBias: "LONG", entryWindow: "now", entryConditions: ["x"], invalidation: "x",
    confidence: 0.6, thesis: "x", keyClaims: [{ claim: "x", evidenceIds: ["x"] }], risks: ["x"],
    alternativeRoute: { direction: "NEUTRAL", entryPrice: null, stopPrice: null, targetPrice: null, timing: "x", rationale: "x", conditions: ["x"], invalidation: "x" },
  };
  const wrongSide = computeRiskCheck(submission, { ...base, entryPrice: 123, stopPrice: 125, targetPrice: 130 });
  assert.equal(wrongSide.primary.levelsValid, false);
  assert.equal(wrongSide.primary.withinRiskBudget, false);
  // 1.5R passes MEDIUM but not LOW (needs 2R).
  const thin = computeRiskCheck(submission, { ...base, entryPrice: 123, stopPrice: 121, targetPrice: 126 });
  assert.equal(thin.primary.rewardRisk, 1.5);
  assert.equal(thin.primary.withinRiskBudget, false);
  assert.equal(computeRiskCheck({ ...submission, riskLevel: "MEDIUM" }, { ...base, entryPrice: 123, stopPrice: 121, targetPrice: 126 }).primary.withinRiskBudget, true);
});

test("resolvePath scores stop, target and drift against the thesis direction", () => {
  const bar = (ts: number, low: number, high: number, close: number): Candle => ({ ts, open: close, high, low, close, volume: 1 });
  assert.equal(resolvePath({ direction: "LONG", entry: 100, stop: 98, target: 104, atrPct: 1, candles: [bar(1, 99, 101, 100), bar(2, 100, 104.5, 104)] }).thesisOutcome, "CONFIRMED");
  assert.equal(resolvePath({ direction: "LONG", entry: 100, stop: 98, target: 104, atrPct: 1, candles: [bar(1, 97.5, 101, 98)] }).thesisOutcome, "REFUTED");
  assert.equal(resolvePath({ direction: "SHORT", entry: 100, stop: 102, target: 96, atrPct: 1, candles: [bar(1, 95.5, 100.5, 96)] }).thesisOutcome, "CONFIRMED");
  // A bar that spans both levels counts against the thesis.
  assert.equal(resolvePath({ direction: "LONG", entry: 100, stop: 98, target: 104, atrPct: 1, candles: [bar(1, 97, 105, 101)] }).thesisOutcome, "REFUTED");
  const drift = resolvePath({ direction: "LONG", entry: 100, stop: 98, target: 104, atrPct: 1, candles: [bar(1, 99.5, 101, 101)] });
  assert.equal(drift.thesisOutcome, "CONFIRMED");
  assert.equal(drift.realizedReturnPct, 1);
  assert.equal(resolvePath({ direction: "LONG", entry: 100, stop: 98, target: 104, atrPct: 1, candles: [bar(1, 99.9, 100.2, 100.1)] }).thesisOutcome, "INCONCLUSIVE");
});

test("the resolver closes the loop on its own and the next ruling is calibrated by it", async () => {
  const repository = createMemoryCaseRepository();
  const completedAt = "2026-09-29T08:00:00.000Z";
  // Price rallies straight through every target after each ruling.
  const evidenceProvider: EvidenceProvider = {
    name: "fixture",
    async collect() { return featureEvidence({ trend: "UP", depth: "ASK_HEAVY" }); },
    async priceHistory({ startMs }) {
      return [{ ts: startMs + 60_000, open: 123, high: 200, low: 122.9, close: 190, volume: 1 }];
    },
  };
  const submission = {
    proposal: { asset: "TSLAUSDT", market: "usdt-futures", timeframe: "4h", direction: "LONG", summary: "Resolver fixture: long the uptrend." },
    riskLevel: "MEDIUM",
    evidence: featureEvidence({ trend: "UP", depth: "ASK_HEAVY" }),
  } as CaseSubmission;
  for (const index of [1, 2, 3]) {
    const id = "case-" + index;
    await repository.createCase({ id, agentId: null, submission, evidenceMode: "MANUAL", status: "READY", createdAt: completedAt, updatedAt: completedAt });
    const result = await runCourt(submission, createMockCourtProvider(), { idFactory: () => "run-" + index, now: () => new Date(completedAt) });
    await repository.createRun({ id: "run-" + index, caseId: id, status: "RUNNING", provider: "mock", model: "m", startedAt: completedAt, completedAt: null, result: null, error: null });
    await repository.completeRun("run-" + index, result, "md");
  }

  // Before the horizon has elapsed nothing is resolved.
  assert.equal(await resolveDueOutcomes({ repository, evidenceProvider, now: () => new Date("2026-09-29T10:00:00.000Z") }), 0);
  // After it, every run is resolved automatically, with no agent involved.
  assert.equal(await resolveDueOutcomes({ repository, evidenceProvider, now: () => new Date("2026-09-29T12:30:00.000Z") }), 3);
  assert.equal(await resolveDueOutcomes({ repository, evidenceProvider, now: () => new Date("2026-09-29T13:00:00.000Z") }), 0);

  const outcomes = await repository.listOutcomes("run-1", null);
  assert.equal(outcomes[0]?.source, "AUTO");
  assert.equal(outcomes[0]?.thesisOutcome, "CONFIRMED");

  const record = await repository.getTrackRecord({ agentId: null, asset: "TSLAUSDT" });
  assert.equal(record.scope, "COURT");
  assert.equal(record.confirmed, 3);
  assert.equal(record.sameAsset.length, 3);
  // The strategy judge dissented against three winning longs: its accuracy is 0.
  assert.equal(record.judges.find((judge) => judge.judgeId === "judge-strategy")?.accuracy, 0);

  const next = await runCourt(submission, createMockCourtProvider(), { trackRecord: record, calibration: record.judges });
  const strategy = next.report.judges.find((judge) => judge.judgeId === "judge-strategy")!;
  assert.equal(strategy.confidence, 0.544);
  assert.equal(next.report.learning?.resolvedOutcomes, 3);
});

test("the public learning endpoint reports court-wide accuracy without case content", async () => {
  const app = await buildApp();
  const response = await app.inject({ method: "GET", url: "/v1/court/learning" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.scope, "COURT");
  assert.equal(body.judges.length, 3);
  assert.equal(JSON.stringify(body).includes("proposal"), false);
  await app.close();
});

test("an OpenRouter burst refusal is waited out instead of failing the court", async () => {
  const { createLlmCourtProvider } = await import("../src/agents/llm-court.js");
  const mock = createMockCourtProvider();
  let calls = 0;
  const provider = createLlmCourtProvider({
    name: "burst-fixture",
    model: "fixture",
    async generate({ name }) {
      calls += 1;
      if (calls === 1) throw new Error("This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle.");
      if (name !== "cerebra_analyst_case") throw new Error("only the analyst is exercised here");
      const submission = { proposal: { asset: "TSLAUSDT", market: "usdt-futures", timeframe: "4h", direction: "LONG", summary: "Burst retry fixture thesis." }, riskLevel: "MEDIUM", evidence: featureEvidence() } as CaseSubmission;
      return (await mock.runAnalyst({ submission, precedents: [] })) as never;
    },
  });
  const submission = { proposal: { asset: "TSLAUSDT", market: "usdt-futures", timeframe: "4h", direction: "LONG", summary: "Burst retry fixture thesis." }, riskLevel: "MEDIUM", evidence: featureEvidence() } as CaseSubmission;
  const result = await provider.runAnalyst({ submission, precedents: [] });
  assert.equal(calls, 2);
  assert.equal(result.output.recommendation, "APPROVE");
});

test("with no side requested, the side the Analyst argues for becomes the primary plan", async () => {
  const provider = createMockCourtProvider();
  const parked: typeof provider = {
    ...provider,
    async runAnalyst(context) {
      const call = await provider.runAnalyst(context);
      // The live model left the primary NEUTRAL and parked its SHORT in the alternative slot.
      return {
        ...call,
        output: {
          ...call.output, recommendation: "REJECT", marketBias: "NEUTRAL", entryPrice: null, stopPrice: null, targetPrice: null,
          alternativeRoute: { direction: "SHORT", entryPrice: 120, stopPrice: 123, targetPrice: 114, timing: "4h", rationale: "Downtrend.", conditions: ["Trend holds."], invalidation: "Close above 123." },
        },
      };
    },
  };
  const submission = { proposal: { asset: "TSLAUSDT", market: "usdt-futures", timeframe: "4h", direction: "EITHER", summary: "Pick whichever side the data supports." }, riskLevel: "MEDIUM", evidence: featureEvidence({ trend: "DOWN" }) } as CaseSubmission;
  const result = await runCourt(submission, parked);
  assert.equal(result.analystCase.recommendation, "APPROVE");
  assert.equal(result.analystCase.marketBias, "SHORT");
  assert.equal(result.analystCase.stopPrice, 123);
  assert.equal(result.analystCase.alternativeRoute.direction, "NEUTRAL");
});

test("reads the affordable token count from an OpenRouter credit refusal", async () => {
  const { affordableTokens } = await import("../src/agents/qwen-provider.js");
  assert.equal(affordableTokens(new Error("This request requires more credits, or fewer max_tokens. You requested up to 1400 tokens, but can only afford 621.")), 621);
  assert.equal(affordableTokens(new Error("timeout")), null);
});

test("every reference plan passes the court's own risk check, on every posture and trend", async () => {
  const { referencePlans, computeRiskCheck: check } = await import("../src/court/risk-check.js");
  for (const trend of ["UP", "DOWN", "FLAT"] as const) {
    for (const riskLevel of ["LOW", "MEDIUM", "HIGH"] as const) {
      const submission = {
        proposal: { asset: "TSLAUSDT", market: "usdt-futures", timeframe: "4h", direction: "EITHER", summary: "Reference plan consistency fixture." },
        riskLevel,
        evidence: featureEvidence({ trend }),
      } as CaseSubmission;
      const features = submission.evidence[0]!.metrics as never;
      const plans = referencePlans(features, riskLevel)!;
      for (const side of ["LONG", "SHORT"] as const) {
        const plan = plans[side];
        const result = check(submission, {
          recommendation: "APPROVE", marketBias: side, entryPrice: plan.entryPrice, stopPrice: plan.stopPrice, targetPrice: plan.targetPrice,
          entryWindow: "now", entryConditions: ["x"], invalidation: "x", confidence: 0.6, thesis: "x",
          keyClaims: [{ claim: "x", evidenceIds: ["x"] }], risks: ["x"],
          alternativeRoute: { direction: "NEUTRAL", entryPrice: null, stopPrice: null, targetPrice: null, timing: "x", rationale: "x", conditions: ["x"], invalidation: "x" },
        });
        assert.equal(result.primary.withinRiskBudget, true, `${trend} ${riskLevel} ${side}: ${result.primary.findings.join(" ")}`);
      }
    }
  }
});

test("the court reads the agent's own saved strategy and beliefs, marking expired ones stale", async () => {
  const seen: Array<import("../src/court/agent-memory.js").AgentMemory | null | undefined> = [];
  const mock = createMockCourtProvider();
  const spying: typeof mock = {
    ...mock,
    async runAnalyst(context) { seen.push(context.agentMemory); return mock.runAnalyst(context); },
  };
  const app = await buildApp({ auth, courtProvider: spying });
  const register = async (name: string) => (await app.inject({
    method: "POST", url: "/v1/agents/register",
    headers: { "x-cerebra-registration-token": registrationToken }, payload: { name },
  })).json().apiKey as string;
  const owner = { authorization: "Bearer " + await register("Memory Agent") };
  const other = { authorization: "Bearer " + await register("Other Agent") };

  // Saved as "TSLA"; the case uses "TSLAUSDT" — both must match.
  assert.equal((await app.inject({ method: "POST", url: "/v1/memory/strategies", headers: owner, payload: {
    asset: "TSLA", timeframe: "4h", thesis: "Trade TSLA only with the 4h trend; never add to losers.",
    constraints: ["No counter-trend entries"], invalidationConditions: ["Daily close below 340"],
  } })).statusCode, 201);
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  for (const [statement, validUntil] of [["Deliveries beat should keep TSLA bid this week", future], ["Pre-earnings drift is upward", past]] as const) {
    assert.equal((await app.inject({ method: "POST", url: "/v1/memory/impressions", headers: owner, payload: {
      asset: "TSLAUSDT", statement, confidence: 0.6, validUntil,
    } })).statusCode, 201);
  }
  await app.inject({ method: "POST", url: "/v1/memory/impressions", headers: other, payload: {
    asset: "TSLAUSDT", statement: "Another agent's private belief", confidence: 0.9,
  } });

  const created = await app.inject({ method: "POST", url: "/v1/cases", headers: owner, payload: manualCase });
  const run = await app.inject({ method: "POST", url: "/v1/cases/" + created.json().id + "/run", headers: owner, payload: { refreshEvidence: false } });
  assert.equal(run.statusCode, 201);

  const memory = seen[0]!;
  assert.equal(memory.strategy?.version, 1);
  assert.deepEqual(memory.strategy?.constraints, ["No counter-trend entries"]);
  assert.equal(memory.beliefs.length, 2);
  assert.equal(memory.fresh, 1);
  assert.equal(memory.stale, 1);
  assert.equal(memory.beliefs.find((belief) => belief.freshness === "EXPIRED")?.statement, "Pre-earnings drift is upward");
  assert.ok(!memory.beliefs.some((belief) => belief.statement.includes("Another agent")));
  assert.deepEqual(run.json().report.learning.agentMemory, { strategyVersion: 1, freshBeliefs: 1, staleBeliefs: 1, undatedBeliefs: 0 });

  // Anonymous runs have no agent memory to read.
  const anonymous = await app.inject({ method: "POST", url: "/v1/cases", payload: manualCase });
  await app.inject({ method: "POST", url: "/v1/cases/" + anonymous.json().id + "/run", payload: { refreshEvidence: false } });
  assert.equal(seen[1], null);
  await app.close();
});

test("reference plans explain their stop placement in plain language", async () => {
  const { referencePlans } = await import("../src/court/risk-check.js");
  const plans = referencePlans(featureEvidence({ trend: "UP" })[0]!.metrics as never, "MEDIUM")!;
  assert.match(plans.LONG.note, /just below the recent swing low|inside the recent range/);
  assert.match(plans.SHORT.note, /just above the recent swing high|inside the recent range/);
  assert.doesNotMatch(plans.LONG.note + plans.SHORT.note, /d.d{6,}/, "prices are rounded");
  for (const plan of [plans.LONG, plans.SHORT]) {
    assert.match(plan.stopPlacement, /^(STRUCTURAL|INSIDE_RANGE)$/);
    assert.ok(plan.targetAtr > 0 && plan.targetAtr < 3, "target distance is a bounded ATR number");
    assert.equal("stopBeyondSwing" in plan, false, "no boolean that reads like a violation");
  }
});

test("flags candles older than two bars as stale and keeps the live bar current", async () => {
  const { dataFreshness } = await import("../src/evidence/market-features.js");
  assert.deepEqual(dataFreshness("2026-10-01T16:00:00.000Z", "2026-10-01T17:11:15.000Z", "4H"), { ageMinutes: 71, stale: false });
  assert.equal(dataFreshness("2026-09-26T20:00:00.000Z", "2026-09-28T17:00:00.000Z", "4H")?.stale, true);
  assert.equal(dataFreshness("x", "2026-10-01T17:00:00.000Z", "4H"), null);
});

test("computes a plan standard that approves clean trend plans and fails counter-trend or out-of-budget ones", async () => {
  const { planStandard } = await import("../src/court/risk-check.js");
  const route = { direction: "LONG", entry: 100, stop: 99, target: 102, riskPct: 1, rewardPct: 2, rewardRisk: 2, stopAtr: 1, levelsValid: true, trendAligned: true, depthAligned: null, withinRiskBudget: true, findings: [] } as never;
  assert.equal(planStandard(route).status, "MEETS_STANDARD");
  assert.equal(planStandard({ ...(route as object), depthAligned: false } as never).status, "MEETS_STANDARD");
  assert.deepEqual(planStandard({ ...(route as object), depthAligned: false } as never).cautions.length, 1);
  assert.equal(planStandard({ ...(route as object), trendAligned: false } as never).status, "FAILS_STANDARD");
  assert.equal(planStandard({ ...(route as object), withinRiskBudget: false } as never).status, "FAILS_STANDARD");
  assert.equal(planStandard({ ...(route as object), direction: "NEUTRAL" } as never).status, "NO_TRADE");
  assert.equal(planStandard(null).status, "NO_TRADE");
});
