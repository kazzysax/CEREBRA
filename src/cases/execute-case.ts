import { randomUUID } from "node:crypto";
import type { CourtModelProvider } from "../agents/contracts.js";
import { runCourt, type CourtRunResult } from "../court/run-court.js";
import { renderRulingMarkdown } from "../domain/report-renderer.js";
import type { EvidenceProvider } from "../evidence/contracts.js";
import type { CaseRepository } from "../storage/contracts.js";

export class CaseExecutionError extends Error {
  constructor(readonly code: "CASE_NOT_FOUND" | "COURT_RUN_FAILED", message: string, readonly runId?: string) {
    super(message);
    this.name = "CaseExecutionError";
  }
}

export async function executeCase(options: {
  caseId: string;
  agentId: string | null;
  refreshEvidence: boolean;
  repository: CaseRepository;
  evidenceProvider: EvidenceProvider;
  courtProvider: CourtModelProvider;
  now?: (() => Date) | undefined;
  idFactory?: (() => string) | undefined;
  onStage?: ((stage: "EVIDENCE" | "ANALYST" | "PERSISTING") => Promise<void>) | undefined;
}): Promise<CourtRunResult> {
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;
  let record = await options.repository.getCase(options.caseId, options.agentId);
  if (!record) throw new CaseExecutionError("CASE_NOT_FOUND", "Case not found");

  const runId = idFactory();
  let runCreated = false;
  try {
    await options.onStage?.("EVIDENCE");
    if (record.evidenceMode === "BITGET" && options.refreshEvidence) {
      const evidence = await options.evidenceProvider.collect(record.submission.proposal);
      record = await options.repository.replaceEvidence(record.id, evidence, now().toISOString());
      if (!record) throw new Error("Case disappeared during evidence refresh");
    }

    const precedents = options.agentId
      ? await options.repository.findPrecedents({
        agentId: options.agentId,
        asset: record.submission.proposal.asset,
        market: record.submission.proposal.market,
        excludeCaseId: record.id,
        limit: 5,
      })
      : [];
    const calibration = options.agentId
      ? await options.repository.getJudgeCalibration(options.agentId)
      : [];
    const startedAt = now().toISOString();
    await options.repository.setCaseStatus(record.id, "RUNNING", startedAt);
    await options.repository.createRun({
      id: runId, caseId: record.id, status: "RUNNING",
      provider: options.courtProvider.name, model: options.courtProvider.model,
      startedAt, completedAt: null, result: null, error: null,
    });
    runCreated = true;
    await options.onStage?.("ANALYST");
    const result = await runCourt(record.submission, options.courtProvider, {
      idFactory: () => runId,
      precedents,
      calibration,
    });
    await options.onStage?.("PERSISTING");
    await options.repository.completeRun(runId, result, renderRulingMarkdown(result.report));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown court run failure";
    if (runCreated) await options.repository.failRun(runId, message, now().toISOString());
    throw new CaseExecutionError("COURT_RUN_FAILED", message, runId);
  }
}
