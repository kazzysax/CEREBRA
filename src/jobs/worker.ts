import { randomUUID } from "node:crypto";
import type { CourtModelProvider } from "../agents/contracts.js";
import { executeCase } from "../cases/execute-case.js";
import type { EvidenceProvider } from "../evidence/contracts.js";
import type { CaseRepository } from "../storage/contracts.js";
import type { CourtJobRepository } from "./contracts.js";

function retryable(error: unknown) {
  return error instanceof Error && /timeout|abort|429|rate limit|network|fetch|5\d\d/i.test(error.message);
}

export function createCourtJobWorker(options: {
  jobs: CourtJobRepository;
  cases: CaseRepository;
  evidenceProvider: EvidenceProvider;
  courtProvider: CourtModelProvider;
  pollIntervalMs?: number | undefined;
  leaseMs?: number | undefined;
  workerId?: string | undefined;
  now?: (() => Date) | undefined;
}) {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const leaseMs = options.leaseMs ?? 900_000;
  const workerId = options.workerId ?? "worker-" + randomUUID();
  const now = options.now ?? (() => new Date());
  let timer: NodeJS.Timeout | null = null;
  let stopped = true;
  let activeRun: Promise<boolean> | null = null;

  async function runOnce() {
    const claimedAt = now();
    const job = await options.jobs.claimNext(workerId, claimedAt.toISOString(), new Date(claimedAt.getTime() + leaseMs).toISOString());
    if (!job) return false;
    try {
      const result = await executeCase({
        caseId: job.caseId, agentId: job.agentId, refreshEvidence: job.refreshEvidence,
        repository: options.cases, evidenceProvider: options.evidenceProvider, courtProvider: options.courtProvider,
        onStage: async (stage) => { await options.jobs.updateStage(job.id, job.generation, stage, now().toISOString()); },
      });
      await options.jobs.completeJob(job.id, job.generation, result.runId, now().toISOString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown job failure";
      await options.jobs.failJob(job.id, job.generation, message, retryable(error), now().toISOString());
    }
    return true;
  }

  async function loop() {
    if (stopped) return;
    try {
      activeRun = runOnce();
      await activeRun;
    } finally {
      activeRun = null;
      if (!stopped) timer = setTimeout(() => void loop(), pollIntervalMs);
    }
  }

  return {
    workerId,
    runOnce,
    start() { if (!stopped) return; stopped = false; void loop(); },
    async stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; if (activeRun) await activeRun; },
  };
}
