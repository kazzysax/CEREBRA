import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createPreviewReport } from "../fixtures/preview-report.js";
import { renderRulingMarkdown } from "../domain/report-renderer.js";

export function createCerebraMcpServer() {
  const server = new McpServer({ name: "cerebra", version: "0.3.0" });

  server.registerTool(
    "cerebra_status",
    { description: "Return Cerebra service and court topology status." },
    async () => ({
      content: [
        {
          type: "text",
          text: "Cerebra is ready. Court: Analyst + Challenger + three equal voting judges.",
        },
      ],
    }),
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
      return {
        content: [{ type: "text", text: renderRulingMarkdown(report) }],
        structuredContent: report,
      };
    },
  );

  return server;
}
