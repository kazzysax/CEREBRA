import type { CourtJobRecord, CourtJobRepository } from "./contracts.js";

const clone = <T>(value: T): T => structuredClone(value);

export function createMemoryCourtJobRepository(): CourtJobRepository {
  const jobs = new Map<string, CourtJobRecord>();
  return {
    name: "memory",
    async createJob(record) {
      if (jobs.has(record.id)) throw new Error("JOB_ALREADY_EXISTS");
      jobs.set(record.id, clone(record)); return clone(record);
    },
    async getJob(id, agentId) {
      const job = jobs.get(id); return job?.agentId === agentId ? clone(job) : null;
    },
    async getByIdempotencyKey(agentId, key) {
      const job = [...jobs.values()].find((item) => item.agentId === agentId && item.idempotencyKey === key);
      return job ? clone(job) : null;
    },
    async claimNext(workerId, now, leaseExpiresAt) {
      const job = [...jobs.values()]
        .filter((item) => item.attemptCount < item.maxAttempts && (
          item.status === "QUEUED" || (item.status === "RUNNING" && Boolean(item.leaseExpiresAt && item.leaseExpiresAt <= now))
        ))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
      if (!job) return null;
      const next: CourtJobRecord = { ...job, status: "RUNNING", stage: "CLAIMED", attemptCount: job.attemptCount + 1, generation: job.generation + 1, leaseOwner: workerId, leaseExpiresAt, updatedAt: now };
      jobs.set(next.id, next); return clone(next);
    },
    async updateStage(id, generation, stage, now) {
      const job = jobs.get(id); if (!job || job.generation !== generation || job.status !== "RUNNING") return false;
      jobs.set(id, { ...job, stage, updatedAt: now }); return true;
    },
    async completeJob(id, generation, runId, now) {
      const job = jobs.get(id); if (!job || job.generation !== generation || job.status !== "RUNNING") return false;
      jobs.set(id, { ...job, runId, status: "COMPLETED", stage: "COMPLETED", leaseOwner: null, leaseExpiresAt: null, updatedAt: now, completedAt: now, error: null }); return true;
    },
    async failJob(id, generation, error, retryable, now) {
      const job = jobs.get(id); if (!job || job.generation !== generation || job.status !== "RUNNING") return false;
      const retry = retryable && job.attemptCount < job.maxAttempts;
      jobs.set(id, { ...job, status: retry ? "QUEUED" : "FAILED", stage: retry ? "RETRYING" : "FAILED", leaseOwner: null, leaseExpiresAt: null, updatedAt: now, completedAt: retry ? null : now, error }); return true;
    },
    async cancelQueuedJob(id, agentId, now) {
      const job = jobs.get(id); if (!job || job.agentId !== agentId || job.status !== "QUEUED") return null;
      const next: CourtJobRecord = { ...job, status: "CANCELLED", stage: "CANCELLED", generation: job.generation + 1, updatedAt: now, completedAt: now };
      jobs.set(id, next); return clone(next);
    },
    async close() {},
  };
}
