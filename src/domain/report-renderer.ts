import type { RulingReport } from "./contracts.js";

export function renderRulingMarkdown(report: RulingReport): string {
  const lines = [
    "# Cerebra ruling: " + report.proposal.id,
    "",
    "**Status:** " + report.status,
    "**Verdict:** " + (report.verdict ?? "No binding verdict"),
    "**Vote:** " + report.tally.approve + " approve / " + report.tally.reject +
      " reject / " + report.tally.abstain + " abstain / " +
      report.tally.unavailable + " unavailable",
    "",
    report.proposal.summary,
    "",
    "## Opinions of the court",
    "",
  ];

  for (const opinion of report.judges) {
    lines.push(
      "### " + opinion.judgeId + " — " + opinion.lens,
      "",
      "- Opinion: " + opinion.opinionType,
      "- Vote: " + (opinion.vote ?? "Unavailable"),
      "- Confidence: " + (opinion.confidence ?? "Unavailable"),
      "- Reason code: " + (opinion.reasonCode ?? "Unavailable"),
      "- Evidence: " + (opinion.evidenceIds.join(", ") || "None"),
      "",
      opinion.rationale,
      "",
    );
  }

  lines.push("## Dissent", "");
  const dissents = report.judges.filter((opinion) => opinion.opinionType === "DISSENT");
  if (dissents.length === 0) {
    lines.push("No dissent was recorded.");
  } else {
    for (const dissent of dissents) {
      lines.push("- **" + dissent.judgeId + ":** " + dissent.rationale);
    }
  }

  if (report.integrity.errors.length > 0) {
    lines.push(
      "",
      "## Integrity errors",
      "",
      ...report.integrity.errors.map((error) => "- " + error),
    );
  }

  return lines.join("\n");
}
