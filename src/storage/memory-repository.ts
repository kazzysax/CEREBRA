import type { EvidenceReference } from "../domain/contracts.js";
import type {
  CaseRecord,
  CaseRepository,
  CaseStatus,
  CourtRunRecord,
  StoredReport,
} from "./contracts.js";
import type { JudgeCalibration, OutcomeRecord } from "../outcomes/contracts.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createMemoryCaseRepository(): CaseRepository {
  const cases = new Map<string, CaseRecord>();
  const runs = new Map<string, CourtRunRecord>();
  const reports = new Map<string, StoredReport>();
  const outcomes = new Map<string, OutcomeRecord>();

  return {
    name: "memory",

    async createCase(record) {
      if (cases.has(record.id)) throw new Error("Case already exists: " + record.id);
      cases.set(record.id, clone(record));
      return clone(record);
    },

    async listCases(limit, agentId) {
      return [...cases.values()]
        .filter((record) => !agentId || record.agentId === agentId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
        .map(clone);
    },

    async getCase(id, agentId) {
      const record = cases.get(id);
      return record && (!agentId || record.agentId === agentId) ? clone(record) : null;
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
        .filter((run) => !agentId || cases.get(run.caseId)?.agentId === agentId)
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
      return !agentId || caseRecord?.agentId === agentId ? clone(record) : null;
    },

    async getReport(runId, agentId) {
      const run = runs.get(runId);
      const caseRecord = run ? cases.get(run.caseId) : null;
      if (agentId && caseRecord?.agentId !== agentId) return null;
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
      if (agentId && record?.agentId !== agentId) return [];
      return [...outcomes.values()].filter((item) => item.runId === runId).sort((a, b) => a.observedAt.localeCompare(b.observedAt)).map(clone);
    },

    async getJudgeCalibration(agentId) {
      const stats = new Map(["judge-risk", "judge-evidence", "judge-strategy"].map((judgeId) => [judgeId, { resolved: 0, correct: 0, incorrect: 0 }]));
      for (const outcome of outcomes.values()) {
        if (outcome.agentId !== agentId || outcome.thesisOutcome === "INCONCLUSIVE") continue;
        const run = runs.get(outcome.runId);
        if (!run?.result) continue;
        for (const judge of run.result.report.judges) {
          if (!judge.vote || judge.vote === "ABSTAIN") continue;
          const stat = stats.get(judge.judgeId)!; stat.resolved += 1;
          const correct = (judge.vote === "APPROVE" && outcome.thesisOutcome === "CONFIRMED") || (judge.vote === "REJECT" && outcome.thesisOutcome === "REFUTED");
          if (correct) stat.correct += 1; else stat.incorrect += 1;
        }
      }
      return [...stats.entries()].map(([judgeId, stat]) => ({ judgeId: judgeId as JudgeCalibration["judgeId"], ...stat, accuracy: stat.resolved ? stat.correct / stat.resolved : null }));
    },

    async close() {},
  };
}
