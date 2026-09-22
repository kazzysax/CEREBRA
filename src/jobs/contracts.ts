export type CourtJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type CourtJobStage = "QUEUED" | "CLAIMED" | "EVIDENCE" | "RECORD" | "ANALYST" | "PERSISTING" | "COMPLETED" | "RETRYING" | "FAILED" | "CANCELLED";

export type CourtJobRecord = {
  id: string;
  agentId: string;
  caseId: string;
  runId: string | null;
  idempotencyKey: string | null;
  refreshEvidence: boolean;
  status: CourtJobStatus;
  stage: CourtJobStage;
  attemptCount: number;
  maxAttempts: number;
  generation: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export interface CourtJobRepository {
  readonly name: string;
  createJob(record: CourtJobRecord): Promise<CourtJobRecord>;
  getJob(id: string, agentId: string): Promise<CourtJobRecord | null>;
  getByIdempotencyKey(agentId: string, key: string): Promise<CourtJobRecord | null>;
  claimNext(workerId: string, now: string, leaseExpiresAt: string): Promise<CourtJobRecord | null>;
  updateStage(id: string, generation: number, stage: CourtJobStage, now: string): Promise<boolean>;
  completeJob(id: string, generation: number, runId: string, now: string): Promise<boolean>;
  failJob(id: string, generation: number, error: string, retryable: boolean, now: string): Promise<boolean>;
  cancelQueuedJob(id: string, agentId: string, now: string): Promise<CourtJobRecord | null>;
  close(): Promise<void>;
}
