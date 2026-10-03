import type { RulingReport } from "../domain/contracts.js";
import type { CaseRepository } from "../storage/contracts.js";
import type { LedgerEntry, LedgerRepository, LedgerSource } from "./contracts.js";
import { GENESIS_HASH, computeEntryHash, digestReport } from "./hash.js";

// Appends a completed, anonymous court run to the public ledger. Only
// anonymous records are reachable here (agentId null), so an agent's private
// rulings can never be published by this path.
export async function appendRunToLedger(
  deps: { ledger: LedgerRepository; cases: CaseRepository },
  input: { runId: string; slotKey: string; source: LedgerSource; now?: (() => Date) | undefined },
): Promise<LedgerEntry | null> {
  const run = await deps.cases.getRun(input.runId, null);
  if (!run || run.status !== "COMPLETED") throw new Error("Run is not a completed public run: " + input.runId);
  const stored = await deps.cases.getReport(input.runId, null);
  if (!stored) throw new Error("Run has no report: " + input.runId);
  const record = await deps.cases.getCase(run.caseId, null);
  if (!record) throw new Error("Run's case is not public: " + input.runId);
  const proposal = record.submission.proposal;
  return deps.ledger.append({
    slotKey: input.slotKey,
    status: "RULED",
    source: input.source,
    asset: proposal.asset,
    timeframe: proposal.timeframe,
    riskLevel: record.submission.riskLevel,
    model: run.model,
    runId: run.id,
    ruledAt: run.completedAt ?? stored.createdAt,
    // Normalised through JSON so the digest matches what Postgres stores.
    report: JSON.parse(JSON.stringify(stored.report)) as unknown,
    missedReason: null,
    createdAt: (input.now?.() ?? new Date()).toISOString(),
  });
}

export type ChainVerification = {
  valid: boolean;
  checked: number;
  headSeq: number | null;
  headHash: string | null;
  firstBrokenSeq: number | null;
  problem: string | null;
};

export async function verifyChain(ledger: LedgerRepository): Promise<ChainVerification> {
  const rows = await ledger.listAll();
  let previous: string = GENESIS_HASH;
  for (const [index, { entry, report }] of rows.entries()) {
    const fail = (problem: string): ChainVerification => ({
      valid: false, checked: index, headSeq: rows.at(-1)?.entry.seq ?? null, headHash: rows.at(-1)?.entry.entryHash ?? null,
      firstBrokenSeq: entry.seq, problem,
    });
    if (entry.seq !== index + 1) return fail("sequence numbers are not contiguous");
    if (entry.prevHash !== previous) return fail("previous-hash link is broken");
    if (entry.status === "RULED") {
      if (report === null) return fail("a ruling has no stored report");
      if (digestReport(report) !== entry.reportDigest) return fail("report content does not match its digest");
    }
    const { entryHash: _hash, score: _score, ...fields } = entry;
    if (computeEntryHash(fields) !== entry.entryHash) return fail("entry hash does not match its fields");
    previous = entry.entryHash;
  }
  const head = rows.at(-1)?.entry;
  return { valid: true, checked: rows.length, headSeq: head?.seq ?? null, headHash: head?.entryHash ?? null, firstBrokenSeq: null, problem: null };
}

type ReportView = Pick<RulingReport, "verdict" | "tally" | "judges" | "recommendation" | "proposal" | "evidence" | "doctrine" | "status">
  & { betterLevel?: Record<string, unknown> | null | undefined; alternativeTally?: { approve: number; reject: number; abstain: number } | null | undefined };

export function toPublicEntry(entry: LedgerEntry, reportValue: unknown | null) {
  const report = reportValue as ReportView | null;
  const features = report?.evidence?.find((item) => /features/.test(item.id));
  const freshness = features?.summary?.split("\n").find((line) => /data freshness/i.test(line)) ?? null;
  return {
    seq: entry.seq,
    slotKey: entry.slotKey,
    status: entry.status,
    source: entry.source,
    asset: entry.asset,
    timeframe: entry.timeframe,
    riskLevel: entry.riskLevel,
    model: entry.model,
    ruledAt: entry.ruledAt,
    missedReason: entry.missedReason,
    thesis: report?.proposal.summary ?? null,
    doctrineVersion: report?.doctrine?.version ?? null,
    verdict: report?.verdict ?? null,
    panelStatus: report?.status ?? null,
    tally: report?.tally ?? null,
    alternativeTally: report?.alternativeTally ?? null,
    recommendation: report ? {
      status: report.recommendation.status,
      direction: report.recommendation.direction,
      source: report.recommendation.source ?? null,
      entryPrice: report.recommendation.entryPrice ?? null,
      stopPrice: report.recommendation.stopPrice ?? null,
      targetPrice: report.recommendation.targetPrice ?? null,
      rewardRisk: report.recommendation.rewardRisk ?? null,
      rationale: report.recommendation.rationale,
    } : null,
    betterLevel: report?.betterLevel ?? null,
    judges: report?.judges.map((judge) => ({
      judgeId: judge.judgeId, lens: judge.lens, vote: judge.vote, confidence: judge.confidence,
      reasonCode: judge.reasonCode, rationale: judge.rationale,
    })) ?? [],
    dataFreshness: freshness,
    evidenceObservedAt: features?.observedAt ?? null,
    score: entry.score,
    hashes: { reportDigest: entry.reportDigest, entryHash: entry.entryHash, prevHash: entry.prevHash },
    createdAt: entry.createdAt,
  };
}

export function summariseTrackRecord(rows: Array<{ entry: LedgerEntry; report: unknown | null }>, verification: ChainVerification) {
  const entries = rows.map((row) => row.entry);
  const ruled = rows.filter((row) => row.entry.status === "RULED");
  const verdict = (row: { report: unknown | null }) => (row.report as ReportView | null)?.verdict ?? null;
  const rec = (row: { report: unknown | null }) => (row.report as ReportView | null)?.recommendation.status ?? null;
  const scored = entries.filter((entry) => entry.score !== null);
  const count = (result: string) => scored.filter((entry) => entry.score!.result === result).length;
  const signals = scored.filter((entry) => entry.score!.kind === "SIGNAL");
  const wins = signals.filter((entry) => entry.score!.result === "WIN").length;
  const losses = signals.filter((entry) => entry.score!.result === "LOSS").length;
  // Older scores carry no basis field; their note says whether a level was touched.
  const basisOf = (entry: LedgerEntry) => entry.score!.basis ?? (/Neither stop nor target hit/.test(entry.score!.note) ? "DRIFT" : "LEVEL");
  const byDrift = (result: string) => signals.filter((entry) => entry.score!.result === result && basisOf(entry) === "DRIFT").length;
  const returns = signals.map((entry) => entry.score!.realizedReturnPct).filter((value): value is number => typeof value === "number");
  const correct = count("REJECTION_CORRECT");
  const missed = count("REJECTION_MISSED");
  const rejectionsScored = scored.filter((entry) => entry.score!.kind === "REJECTION").length;
  // Side balance of the trades the court advised, so a drift toward one side or
  // toward fading the trend is visible instead of anecdotal.
  const advised = ruled.flatMap((row) => {
    const report = row.report as (ReportView & { riskCheck?: { trend?: string | null } | null }) | null;
    const recommendation = report?.recommendation;
    if (!recommendation || recommendation.status !== "ACTIONABLE" || (recommendation.direction !== "LONG" && recommendation.direction !== "SHORT")) return [];
    return [{ direction: recommendation.direction, trend: report?.riskCheck?.trend ?? null }];
  });
  const withTrend = advised.filter((item) => (item.direction === "LONG" && item.trend === "UP") || (item.direction === "SHORT" && item.trend === "DOWN")).length;
  const againstTrend = advised.filter((item) => (item.direction === "LONG" && item.trend === "DOWN") || (item.direction === "SHORT" && item.trend === "UP")).length;
  return {
    since: entries[0]?.ruledAt ?? null,
    rulings: ruled.length,
    missedSlots: entries.filter((entry) => entry.status === "MISSED").length,
    approved: ruled.filter((row) => verdict(row) === "APPROVE").length,
    rejected: ruled.filter((row) => verdict(row) === "REJECT").length,
    actionable: ruled.filter((row) => rec(row) === "ACTIONABLE").length,
    pendingScore: ruled.filter((row) => row.entry.score === null).length,
    signals: {
      scored: signals.length, wins, losses, flat: signals.length - wins - losses,
      winsByDrift: byDrift("WIN"), lossesByDrift: byDrift("LOSS"),
      winRatePct: wins + losses ? Math.round((wins / (wins + losses)) * 1000) / 10 : null,
      averageReturnPct: returns.length ? Math.round((returns.reduce((sum, value) => sum + value, 0) / returns.length) * 1000) / 1000 : null,
    },
    rejections: {
      scored: rejectionsScored, correct, missed,
      accuracyPct: correct + missed ? Math.round((correct / (correct + missed)) * 1000) / 10 : null,
    },
    notScorable: count("NOT_SCORABLE"),
    sideBalance: {
      long: advised.filter((item) => item.direction === "LONG").length,
      short: advised.filter((item) => item.direction === "SHORT").length,
      withTrend,
      againstTrend,
    },
    chain: { valid: verification.valid, headSeq: verification.headSeq, headHash: verification.headHash },
    note: "Scores are computed by code from Bitget candles after each ruling's horizon. Small samples prove nothing: read the counts, not just the percentages.",
  };
}
