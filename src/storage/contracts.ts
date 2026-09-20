import type { CaseSubmission } from "../agents/contracts.js";
import type { CourtRunResult } from "../court/run-court.js";
import type { EvidenceReference, RulingReport } from "../domain/contracts.js";
import type { CourtPrecedent, PrecedentQuery } from "../court/precedent.js";
import type { JudgeCalibration, OutcomeRecord } from "../outcomes/contracts.js";

export type EvidenceMode = "BITGET" | "MANUAL";
export type CaseStatus = "READY" | "RUNNING" | "COMPLETED" | "FAILED";
export type RunStatus = "RUNNING" | "COMPLETED" | "FAILED";

export type CaseRecord = {
  id: string;
  agentId: string | null;
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
  listCases(limit: number, agentId?: string | null): Promise<CaseRecord[]>;
  getCase(id: string, agentId?: string | null): Promise<CaseRecord | null>;
  replaceEvidence(id: string, evidence: EvidenceReference[], updatedAt: string): Promise<CaseRecord | null>;
  setCaseStatus(id: string, status: CaseStatus, updatedAt: string): Promise<void>;
  createRun(record: CourtRunRecord): Promise<CourtRunRecord>;
  listRuns(limit: number, agentId?: string | null): Promise<CourtRunRecord[]>;
  completeRun(id: string, result: CourtRunResult, markdown: string): Promise<void>;
  failRun(id: string, error: string, completedAt: string): Promise<void>;
  getRun(id: string, agentId?: string | null): Promise<CourtRunRecord | null>;
  getReport(runId: string, agentId?: string | null): Promise<StoredReport | null>;
  findPrecedents(query: PrecedentQuery): Promise<CourtPrecedent[]>;
  saveOutcome(record: OutcomeRecord): Promise<OutcomeRecord>;
  listOutcomes(runId: string, agentId?: string | null): Promise<OutcomeRecord[]>;
  getJudgeCalibration(agentId: string): Promise<JudgeCalibration[]>;
  close(): Promise<void>;
}
