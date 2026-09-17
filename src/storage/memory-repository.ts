import type { EvidenceReference } from "../domain/contracts.js";
import type {
  CaseRecord,
  CaseRepository,
  CaseStatus,
  CourtRunRecord,
  StoredReport,
} from "./contracts.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createMemoryCaseRepository(): CaseRepository {
  const cases = new Map<string, CaseRecord>();
  const runs = new Map<string, CourtRunRecord>();
  const reports = new Map<string, StoredReport>();

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

    async close() {},
  };
}
