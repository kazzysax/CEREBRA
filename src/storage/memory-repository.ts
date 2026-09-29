import type { EvidenceReference } from "../domain/contracts.js";
import type {
  CaseRecord,
  CaseRepository,
  CaseStatus,
  CourtRunRecord,
  StoredReport,
} from "./contracts.js";
import type { OutcomeRecord } from "../outcomes/contracts.js";
import { buildTrackRecord, MIN_AGENT_RESOLVED, scoreJudges, type ScoredRun } from "../outcomes/scoring.js";
import type { ResolvedPrecedent } from "../court/track-record.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

// An agent sees only its own records; an anonymous caller (null) only anonymous ones.
function owns(recordAgentId: string | null | undefined, agentId: string | null | undefined): boolean {
  return (recordAgentId ?? null) === (agentId ?? null);
}

export function createMemoryCaseRepository(): CaseRepository {
  const cases = new Map<string, CaseRecord>();
  const runs = new Map<string, CourtRunRecord>();
  const reports = new Map<string, StoredReport>();
  const outcomes = new Map<string, OutcomeRecord>();

  function latestOutcome(runId: string): OutcomeRecord | undefined {
    return [...outcomes.values()].filter((item) => item.runId === runId).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  }

  // agentId undefined = every resolved outcome (court-wide); otherwise that owner's scope.
  function scoredRuns(agentId: string | null | undefined): ScoredRun[] {
    return [...outcomes.values()].flatMap((outcome) => {
      const run = runs.get(outcome.runId);
      if (!run?.result) return [];
      if (agentId !== undefined && !owns(cases.get(run.caseId)?.agentId, agentId)) return [];
      return [{ thesisOutcome: outcome.thesisOutcome, judges: run.result.report.judges }];
    });
  }

  return {
    name: "memory",

    async createCase(record) {
      if (cases.has(record.id)) throw new Error("Case already exists: " + record.id);
      cases.set(record.id, clone(record));
      return clone(record);
    },

    async listCases(limit, agentId) {
      return [...cases.values()]
        .filter((record) => owns(record.agentId, agentId))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
        .map(clone);
    },

    async getCase(id, agentId) {
      const record = cases.get(id);
      return record && owns(record.agentId, agentId) ? clone(record) : null;
    },

    async replaceEvidence(id, evidence: EvidenceReference[], updatedAt) {
      const record = cases.get(id);
      if (!record) return null;
      const next: CaseRecord = {
        ...record,
        submission: { ...record.submission, evidence: clone(evidence) },
        status: "READY",
        updatedAt,
      };
      cases.set(id, next);
      return clone(next);
    },

    async setCaseStatus(id: string, status: CaseStatus, updatedAt: string) {
      const record = cases.get(id);
      if (record) cases.set(id, { ...record, status, updatedAt });
    },

    async createRun(record) {
      if (runs.has(record.id)) throw new Error("Run already exists: " + record.id);
      runs.set(record.id, clone(record));
      return clone(record);
    },

    async listRuns(limit, agentId) {
      return [...runs.values()]
        .filter((run) => owns(cases.get(run.caseId)?.agentId, agentId))
        .sort((left, right) => (right.completedAt ?? right.startedAt).localeCompare(left.completedAt ?? left.startedAt))
        .slice(0, limit)
        .map(clone);
    },

    async completeRun(id, result, markdown) {
      const record = runs.get(id);
      if (!record) throw new Error("Unknown run: " + id);
      runs.set(id, {
        ...record,
        status: "COMPLETED",
        completedAt: result.completedAt,
        result: clone(result),
        error: null,
      });
      reports.set(id, {
        runId: id,
        report: clone(result.report),
        markdown,
        createdAt: result.completedAt,
      });
      const caseRecord = cases.get(record.caseId);
      if (caseRecord) {
        cases.set(record.caseId, {
          ...caseRecord,
          status: "COMPLETED",
          updatedAt: result.completedAt,
        });
      }
    },

    async failRun(id, error, completedAt) {
      const record = runs.get(id);
      if (!record) return;
      runs.set(id, { ...record, status: "FAILED", error, completedAt });
      const caseRecord = cases.get(record.caseId);
      if (caseRecord) {
        cases.set(record.caseId, { ...caseRecord, status: "FAILED", updatedAt: completedAt });
      }
    },

    async getRun(id, agentId) {
      const record = runs.get(id);
      if (!record) return null;
      const caseRecord = cases.get(record.caseId);
      return owns(caseRecord?.agentId, agentId) ? clone(record) : null;
    },

    async getReport(runId, agentId) {
      const run = runs.get(runId);
      const caseRecord = run ? cases.get(run.caseId) : null;
      if (!caseRecord || !owns(caseRecord.agentId, agentId)) return null;
      const report = reports.get(runId);
      return report ? clone(report) : null;
    },

    async findPrecedents(query) {
      return [...runs.values()]
        .filter((run) => run.status === "COMPLETED" && run.result && run.caseId !== query.excludeCaseId)
        .map((run) => ({ run, record: cases.get(run.caseId) }))
        .filter((entry): entry is { run: CourtRunRecord; record: CaseRecord } => Boolean(entry.record))
        .filter(({ record }) => record.agentId === query.agentId
          && record.submission.proposal.asset === query.asset
          && record.submission.proposal.market === query.market)
        .sort((left, right) => (right.run.completedAt ?? "").localeCompare(left.run.completedAt ?? ""))
        .slice(0, query.limit)
        .map(({ run, record }) => ({
          caseId: record.id,
          runId: run.id,
          concludedAt: run.completedAt!,
          asset: record.submission.proposal.asset,
          market: record.submission.proposal.market,
          timeframe: record.submission.proposal.timeframe,
          riskLevel: record.submission.riskLevel,
          proposalSummary: record.submission.proposal.summary,
          status: run.result!.report.status,
          verdict: run.result!.report.verdict,
          dissentingJudgeIds: [...run.result!.report.dissentingJudgeIds],
          outcome: latestOutcome(run.id)?.thesisOutcome ?? null,
          realizedReturnPct: latestOutcome(run.id)?.realizedReturnPct ?? null,
        }));
    },

    async saveOutcome(record) {
      const existing = [...outcomes.values()].find((item) => item.runId === record.runId && item.horizon === record.horizon);
      if (existing) outcomes.delete(existing.id);
      outcomes.set(record.id, clone(record));
      return clone(record);
    },

    async listOutcomes(runId, agentId) {
      const run = runs.get(runId); const record = run ? cases.get(run.caseId) : null;
      if (!record || !owns(record.agentId, agentId)) return [];
      return [...outcomes.values()].filter((item) => item.runId === runId).sort((a, b) => a.observedAt.localeCompare(b.observedAt)).map(clone);
    },

    async getJudgeCalibration(agentId) {
      return scoreJudges(scoredRuns(agentId === null ? undefined : agentId));
    },

    async getTrackRecord({ agentId, asset }) {
      const own = scoredRuns(agentId);
      const useOwn = agentId !== null && own.filter((run) => run.thesisOutcome !== "INCONCLUSIVE").length >= MIN_AGENT_RESOLVED;
      const sameAsset: ResolvedPrecedent[] = [...outcomes.values()]
        .map((outcome) => ({ outcome, run: runs.get(outcome.runId) }))
        .filter(({ run }) => run?.result && owns(cases.get(run.caseId)?.agentId, agentId))
        .filter(({ run }) => cases.get(run!.caseId)?.submission.proposal.asset === asset)
        .filter(({ run }) => run!.result!.analystCase.marketBias !== "NEUTRAL")
        .sort((left, right) => right.outcome.observedAt.localeCompare(left.outcome.observedAt))
        .map(({ outcome, run }) => ({
          asset,
          timeframe: cases.get(run!.caseId)!.submission.proposal.timeframe,
          direction: run!.result!.analystCase.marketBias as "LONG" | "SHORT",
          verdict: run!.result!.report.verdict,
          outcome: outcome.thesisOutcome,
          realizedReturnPct: outcome.realizedReturnPct ?? null,
          concludedAt: outcome.observedAt,
        }));
      return buildTrackRecord({ scope: useOwn ? "AGENT" : "COURT", scored: useOwn ? own : scoredRuns(undefined), sameAsset });
    },

    async listRunsAwaitingOutcome(completedBefore, limit) {
      const resolved = new Set([...outcomes.values()].map((outcome) => outcome.runId));
      return [...runs.values()]
        .filter((run) => run.status === "COMPLETED" && run.completedAt && run.completedAt <= completedBefore && !resolved.has(run.id))
        .sort((left, right) => left.completedAt!.localeCompare(right.completedAt!))
        .slice(0, limit)
        .flatMap((run) => {
          const record = cases.get(run.caseId);
          if (!record) return [];
          return [{
            runId: run.id,
            agentId: record.agentId,
            completedAt: run.completedAt!,
            asset: record.submission.proposal.asset,
            market: record.submission.proposal.market,
            timeframe: record.submission.proposal.timeframe,
            result: clone(run.result),
          }];
        });
    },

    async close() {},
  };
}
