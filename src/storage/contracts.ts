import type { CaseSubmission } from "../agents/contracts.js";
import type { CourtRunResult } from "../court/run-court.js";
import type { EvidenceReference, RulingReport } from "../domain/contracts.js";
import type { CourtPrecedent, PrecedentQuery } from "../court/precedent.js";
import type { AwaitingOutcome, JudgeCalibration, OutcomeRecord } from "../outcomes/contracts.js";
import type { TrackRecord } from "../court/track-record.js";

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

// Ownership rule for every read below: an agentId sees only its own records;
// null (an anonymous caller) sees only anonymous records, never agent-owned ones.
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
  // agentId null = court-wide accuracy across every resolved outcome.
  getJudgeCalibration(agentId: string | null): Promise<JudgeCalibration[]>;
  getTrackRecord(query: { agentId: string | null; asset: string }): Promise<TrackRecord>;
  // Internal (resolver only): completed runs that have no outcome recorded yet.
  listRunsAwaitingOutcome(completedBefore: string, limit: number): Promise<AwaitingOutcome[]>;
  close(): Promise<void>;
}
