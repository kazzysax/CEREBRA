import type { CaseSubmission } from "../agents/contracts.js";
import type { CourtRunResult } from "../court/run-court.js";
import type { EvidenceReference, RulingReport } from "../domain/contracts.js";

export type EvidenceMode = "BITGET" | "MANUAL";
export type CaseStatus = "READY" | "RUNNING" | "COMPLETED" | "FAILED";
export type RunStatus = "RUNNING" | "COMPLETED" | "FAILED";

export type CaseRecord = {
  id: string;
  submission: CaseSubmission;
  evidenceMode: EvidenceMode;
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
};

export type CourtRunRecord = {
  id: string;
  caseId: string;
  status: RunStatus;
  provider: string;
  model: string;
  startedAt: string;
  completedAt: string | null;
  result: CourtRunResult | null;
  error: string | null;
};

export type StoredReport = {
  runId: string;
  report: RulingReport;
  markdown: string;
  createdAt: string;
};

export interface CaseRepository {
  readonly name: string;
  createCase(record: CaseRecord): Promise<CaseRecord>;
  listCases(limit: number): Promise<CaseRecord[]>;
  getCase(id: string): Promise<CaseRecord | null>;
  replaceEvidence(id: string, evidence: EvidenceReference[], updatedAt: string): Promise<CaseRecord | null>;
  setCaseStatus(id: string, status: CaseStatus, updatedAt: string): Promise<void>;
  createRun(record: CourtRunRecord): Promise<CourtRunRecord>;
  completeRun(id: string, result: CourtRunResult, markdown: string): Promise<void>;
  failRun(id: string, error: string, completedAt: string): Promise<void>;
  getRun(id: string): Promise<CourtRunRecord | null>;
  getReport(runId: string): Promise<StoredReport | null>;
  close(): Promise<void>;
}
