import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { createMockEvidenceProvider } from "../src/evidence/mock-evidence-provider.js";
import { createMemoryCaseRepository } from "../src/storage/memory-repository.js";

test("persists the case, court run, three opinions, and dissent report", async () => {
  const repository = createMemoryCaseRepository();
  const evidenceProvider = createMockEvidenceProvider(
    () => new Date("2026-09-17T12:00:00.000Z"),
  );
  const app = await buildApp({ repository, evidenceProvider });

  const createdResponse = await app.inject({
    method: "POST",
    url: "/v1/cases",
    payload: {
      proposal: {
        asset: "BTCUSDT",
        market: "spot",
        timeframe: "4h",
        summary: "Evaluate a provisional BTC long thesis for the next four hours.",
      },
      riskLevel: "MEDIUM",
      evidenceMode: "BITGET",
    },
  });
  assert.equal(createdResponse.statusCode, 201);
  const created = createdResponse.json();
  assert.equal(created.evidenceMode, "BITGET");
  assert.equal(created.submission.evidence.length, 1);

  const runResponse = await app.inject({
    method: "POST",
    url: "/v1/cases/" + created.id + "/run",
    payload: { refreshEvidence: false },
  });
  assert.equal(runResponse.statusCode, 201);
  const run = runResponse.json();
  assert.equal(run.report.judges.length, 3);
  assert.deepEqual(run.report.dissentingJudgeIds, ["judge-risk"]);

  const storedRunResponse = await app.inject({
    method: "GET",
    url: "/v1/runs/" + run.runId,
  });
  assert.equal(storedRunResponse.statusCode, 200);
  assert.equal(storedRunResponse.json().status, "COMPLETED");

  const reportResponse = await app.inject({
    method: "GET",
    url: "/v1/runs/" + run.runId + "/report",
  });
  assert.equal(reportResponse.statusCode, 200);
  const storedReport = reportResponse.json();
  assert.deepEqual(storedReport.report.dissentingJudgeIds, ["judge-risk"]);
  assert.match(storedReport.markdown, /## Dissent/);
  assert.match(storedReport.markdown, /judge-risk/);

  const caseResponse = await app.inject({
    method: "GET",
    url: "/v1/cases/" + created.id,
  });
  assert.equal(caseResponse.statusCode, 200);
  assert.equal(caseResponse.json().status, "COMPLETED");
  await app.close();
});

test("requires evidence for manual cases and refuses to refresh them", async () => {
  const app = await buildApp();
  const invalid = await app.inject({
    method: "POST",
    url: "/v1/cases",
    payload: {
      proposal: {
        asset: "ETHUSDT",
        timeframe: "1h",
        summary: "Evaluate an ETH thesis with manually supplied supporting evidence.",
      },
      riskLevel: "LOW",
      evidenceMode: "MANUAL",
      evidence: [],
    },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error, "INVALID_CASE");

  const created = await app.inject({
    method: "POST",
    url: "/v1/cases",
    payload: {
      proposal: {
        asset: "ETHUSDT",
        timeframe: "1h",
        summary: "Evaluate an ETH thesis with manually supplied supporting evidence.",
      },
      riskLevel: "LOW",
      evidenceMode: "MANUAL",
      evidence: [{
        id: "manual-1",
        title: "Manual market observation",
        source: "user",
        observedAt: "2026-09-17T12:00:00.000Z",
        digest: "sha256:manual",
        summary: "A manually collected market observation for test coverage.",
      }],
    },
  });
  assert.equal(created.statusCode, 201);

  const refresh = await app.inject({
    method: "POST",
    url: "/v1/cases/" + created.json().id + "/evidence/refresh",
  });
  assert.equal(refresh.statusCode, 409);
  assert.equal(refresh.json().error, "MANUAL_EVIDENCE_CANNOT_REFRESH");
  await app.close();
});
