import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { caseSubmissionSchema, type CourtModelProvider } from "../agents/contracts.js";
import { createCaseSchema } from "../cases/contracts.js";
import { runCourt } from "../court/run-court.js";
import { renderRulingMarkdown } from "../domain/report-renderer.js";
import type { EvidenceProvider } from "../evidence/contracts.js";
import { createPreviewReport } from "../fixtures/preview-report.js";
import { currentAgentIdentity } from "../identity/context.js";
import type { CaseRepository } from "../storage/contracts.js";

type CerebraMcpOptions = {
  repository: CaseRepository;
  evidenceProvider: EvidenceProvider;
  courtProvider: CourtModelProvider;
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
  const server = new McpServer({ name: "cerebra", version: "0.5.0" });
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;
  const ownerId = () => currentAgentIdentity()?.id ?? null;

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
      let record = await options.repository.getCase(caseId, ownerId());
      if (!record) throw new Error("CASE_NOT_FOUND");
      if (record.evidenceMode === "BITGET" && refreshEvidence) {
        const evidence = await options.evidenceProvider.collect(record.submission.proposal);
        record = await options.repository.replaceEvidence(record.id, evidence, now().toISOString());
        if (!record) throw new Error("CASE_NOT_FOUND");
      }

      const runId = idFactory();
      const startedAt = now().toISOString();
      await options.repository.setCaseStatus(record.id, "RUNNING", startedAt);
      await options.repository.createRun({
        id: runId,
        caseId: record.id,
        status: "RUNNING",
        provider: options.courtProvider.name,
        model: options.courtProvider.model,
        startedAt,
        completedAt: null,
        result: null,
        error: null,
      });

      try {
        const courtResult = await runCourt(record.submission, options.courtProvider, {
          idFactory: () => runId,
        });
        await options.repository.completeRun(
          runId,
          courtResult,
          renderRulingMarkdown(courtResult.report),
        );
        return result(courtResult);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown court run failure";
        await options.repository.failRun(runId, message, now().toISOString());
        throw error;
      }
    },
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
