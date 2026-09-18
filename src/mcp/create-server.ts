import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { caseSubmissionSchema, type CourtModelProvider } from "../agents/contracts.js";
import { createCaseSchema } from "../cases/contracts.js";
import { executeCase } from "../cases/execute-case.js";
import { renderRulingMarkdown } from "../domain/report-renderer.js";
import type { EvidenceProvider } from "../evidence/contracts.js";
import { createPreviewReport } from "../fixtures/preview-report.js";
import { currentAgentIdentity } from "../identity/context.js";
import type { CaseRepository } from "../storage/contracts.js";
import type { CourtJobRecord, CourtJobRepository } from "../jobs/contracts.js";
import type { AgentMemoryRepository } from "../memory/contracts.js";
import { createCheckpointSchema, createStrategyVersionSchema } from "../memory/contracts.js";

type CerebraMcpOptions = {
  repository: CaseRepository;
  evidenceProvider: EvidenceProvider;
  courtProvider: CourtModelProvider;
  jobs: CourtJobRepository;
  memory: AgentMemoryRepository;
  maxJobAttempts?: number | undefined;
  now?: (() => Date) | undefined;
  idFactory?: (() => string) | undefined;
};

function result(value: unknown, text?: string) {
  return {
    content: [{ type: "text" as const, text: text ?? JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export function createCerebraMcpServer(options: CerebraMcpOptions) {
  const server = new McpServer({ name: "cerebra", version: "0.6.0" });
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;
  const ownerId = () => currentAgentIdentity()?.id ?? null;
  const requiredOwnerId = () => {
    const id = ownerId();
    if (!id) throw new Error("AGENT_AUTHENTICATION_REQUIRED");
    return id;
  };

  server.registerTool(
    "cerebra_status",
    { description: "Return Cerebra service, identity, data, and court topology status." },
    async () => result({
      status: "ready",
      authenticatedAgent: currentAgentIdentity(),
      evidenceProvider: options.evidenceProvider.name,
      courtProvider: options.courtProvider.name,
      model: options.courtProvider.model,
      storage: options.repository.name,
      memory: options.memory.name,
      jobs: options.jobs.name,
      topology: {
        researchers: ["analyst", "challenger"],
        judges: ["judge-risk", "judge-evidence", "judge-strategy"],
        votingRule: "equal-weight simple majority",
      },
    }),
  );

  server.registerTool(
    "cerebra_create_case",
    {
      description: "Create a stock decision case and gather Bitget evidence or accept supplied evidence.",
      inputSchema: createCaseSchema,
    },
    async (input) => {
      const caseId = idFactory();
      const proposal = {
        ...input.proposal,
        id: input.proposal.id ?? "proposal-" + caseId,
      };
      const evidence = input.evidenceMode === "BITGET"
        ? await options.evidenceProvider.collect(proposal)
        : input.evidence;
      const submission = caseSubmissionSchema.parse({
        proposal,
        riskLevel: input.riskLevel,
        evidence,
      });
      const timestamp = now().toISOString();
      const record = await options.repository.createCase({
        id: caseId,
        agentId: ownerId(),
        submission,
        evidenceMode: input.evidenceMode,
        status: "READY",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return result(record);
    },
  );

  server.registerTool(
    "cerebra_run_court",
    {
      description: "Run the Analyst, Challenger, and three-judge court for an owned Cerebra case.",
      inputSchema: z.object({
        caseId: z.string().trim().min(1),
        refreshEvidence: z.boolean().default(true),
      }),
    },
    async ({ caseId, refreshEvidence }) => {
      return result(await executeCase({
        caseId, agentId: ownerId(), refreshEvidence,
        repository: options.repository, evidenceProvider: options.evidenceProvider,
        courtProvider: options.courtProvider, now, idFactory,
      }));
    },
  );

  server.registerTool(
    "cerebra_enqueue_court",
    {
      description: "Create a durable, retryable court job and return its addressable job ID immediately.",
      inputSchema: z.object({
        caseId: z.string().trim().min(1),
        refreshEvidence: z.boolean().default(true),
        idempotencyKey: z.string().trim().min(1).max(200).nullable().default(null),
      }),
    },
    async ({ caseId, refreshEvidence, idempotencyKey }) => {
      const agentId = requiredOwnerId();
      if (!await options.repository.getCase(caseId, agentId)) throw new Error("CASE_NOT_FOUND");
      if (idempotencyKey) {
        const existing = await options.jobs.getByIdempotencyKey(agentId, idempotencyKey);
        if (existing) return result(existing);
      }
      const timestamp = now().toISOString();
      const job: CourtJobRecord = {
        id: idFactory(), agentId, caseId, runId: null, idempotencyKey, refreshEvidence,
        status: "QUEUED", stage: "QUEUED", attemptCount: 0, maxAttempts: options.maxJobAttempts ?? 3,
        generation: 0, leaseOwner: null, leaseExpiresAt: null, error: null,
        createdAt: timestamp, updatedAt: timestamp, completedAt: null,
      };
      return result(await options.jobs.createJob(job));
    },
  );

  server.registerTool(
    "cerebra_get_job",
    {
      description: "Read durable court-job progress and its final run ID.",
      inputSchema: z.object({ jobId: z.string().trim().min(1) }),
    },
    async ({ jobId }) => {
      const job = await options.jobs.getJob(jobId, requiredOwnerId());
      if (!job) throw new Error("JOB_NOT_FOUND");
      return result(job);
    },
  );

  server.registerTool(
    "cerebra_save_strategy",
    {
      description: "Persist an immutable strategy version in the authenticated agent's memory.",
      inputSchema: createStrategyVersionSchema,
    },
    async (input) => result(await options.memory.createStrategy({
      id: idFactory(), agentId: requiredOwnerId(), ...input, createdAt: now().toISOString(),
    })),
  );

  server.registerTool(
    "cerebra_recall_memory",
    {
      description: "Recall timestamped agent impressions for an asset with expiration labels.",
      inputSchema: z.object({ asset: z.string().trim().min(2).max(40), limit: z.number().int().min(1).max(100).default(20) }),
    },
    async ({ asset, limit }) => result({ impressions: await options.memory.recallImpressions(requiredOwnerId(), asset.toUpperCase(), limit, now().toISOString()) }),
  );

  server.registerTool(
    "cerebra_save_checkpoint",
    {
      description: "Persist a restorable agent checkpoint without replaying external actions.",
      inputSchema: createCheckpointSchema,
    },
    async (input) => result(await options.memory.createCheckpoint({
      id: idFactory(), agentId: requiredOwnerId(), ...input, createdAt: now().toISOString(),
    })),
  );

  server.registerTool(
    "cerebra_get_report",
    {
      description: "Retrieve the complete Decision Kit for an owned run, including evidence, arguments, ballots, and dissent.",
      inputSchema: z.object({ runId: z.string().trim().min(1) }),
    },
    async ({ runId }) => {
      const report = await options.repository.getReport(runId, ownerId());
      if (!report) throw new Error("REPORT_NOT_FOUND");
      return result(report, report.markdown);
    },
  );

  server.registerTool(
    "court_tally_preview",
    {
      description: "Generate a deterministic synthetic three-judge ruling to inspect the report contract.",
      inputSchema: z.object({
        riskVote: z.enum(["APPROVE", "REJECT", "ABSTAIN"]),
        evidenceVote: z.enum(["APPROVE", "REJECT", "ABSTAIN"]),
        strategyVote: z.enum(["APPROVE", "REJECT", "ABSTAIN"]),
      }),
    },
    async ({ riskVote, evidenceVote, strategyVote }) => {
      const report = createPreviewReport([riskVote, evidenceVote, strategyVote]);
      return result(report, renderRulingMarkdown(report));
    },
  );

  return server;
}
