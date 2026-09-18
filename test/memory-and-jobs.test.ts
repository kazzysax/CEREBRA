import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { createMockCourtProvider } from "../src/agents/mock-provider.js";
import { createMockEvidenceProvider } from "../src/evidence/mock-evidence-provider.js";
import { createMemoryCourtJobRepository } from "../src/jobs/memory-repository.js";
import { createCourtJobWorker } from "../src/jobs/worker.js";
import { createMemoryCaseRepository } from "../src/storage/memory-repository.js";

const registrationToken = "memory-registration-token-that-is-long-enough";
const auth = {
  mode: "agent-key" as const,
  apiKeyPepper: "memory-agent-key-pepper-that-is-long-enough",
  registrationToken,
};

async function registeredApp() {
  const app = await buildApp({ auth });
  const registration = await app.inject({
    method: "POST", url: "/v1/agents/register",
    headers: { "x-cerebra-registration-token": registrationToken },
    payload: { name: "Memory Agent" },
  });
  return { app, apiKey: registration.json().apiKey as string };
}

test("persists strategy versions, impressions, and restorable checkpoints per agent", async () => {
  const { app, apiKey } = await registeredApp();
  const headers = { authorization: "Bearer " + apiKey };
  const first = await app.inject({
    method: "POST", url: "/v1/memory/strategies", headers,
    payload: { asset: "BTCUSDT", timeframe: "4h", thesis: "Momentum remains constructive while market depth supports the move." },
  });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().version, 1);
  const second = await app.inject({
    method: "POST", url: "/v1/memory/strategies", headers,
    payload: { asset: "BTCUSDT", timeframe: "4h", thesis: "The revised thesis requires price acceptance above the invalidation level.", parentVersionId: first.json().id },
  });
  assert.equal(second.statusCode, 201);
  assert.equal(second.json().version, 2);

  const impression = await app.inject({
    method: "POST", url: "/v1/memory/impressions", headers,
    payload: { strategyVersionId: second.json().id, asset: "BTCUSDT", statement: "Liquidity is thinner than the first review assumed.", confidence: 0.72, validUntil: "2020-01-01T00:00:00.000Z" },
  });
  assert.equal(impression.statusCode, 201);
  const recalled = await app.inject({ method: "GET", url: "/v1/memory/recall?asset=BTCUSDT", headers });
  assert.equal(recalled.statusCode, 200);
  assert.equal(recalled.json().impressions[0].isExpired, true);

  const checkpoint = await app.inject({
    method: "POST", url: "/v1/memory/checkpoints", headers,
    payload: { strategyVersionId: second.json().id, state: { phase: "awaiting-human-review", runId: "run-42" }, lastAcknowledgedActionId: "report-viewed-42", reconciliationRequired: true },
  });
  assert.equal(checkpoint.statusCode, 201);
  const restored = await app.inject({ method: "GET", url: "/v1/memory/checkpoints/latest", headers });
  assert.equal(restored.statusCode, 200);
  assert.deepEqual(restored.json().state, { phase: "awaiting-human-review", runId: "run-42" });
  assert.equal(restored.json().reconciliationRequired, true);
  await app.close();
});

test("claims and completes an addressable durable court job", async () => {
  const cases = createMemoryCaseRepository();
  const jobs = createMemoryCourtJobRepository();
  const timestamp = "2026-09-18T00:00:00.000Z";
  await cases.createCase({
    id: "case-job", agentId: "agent-job", evidenceMode: "MANUAL", status: "READY",
    createdAt: timestamp, updatedAt: timestamp,
    submission: {
      proposal: { id: "proposal-job", asset: "BTCUSDT", market: "spot", timeframe: "4h", summary: "Evaluate a bounded BTC position with a human execution gate." },
      riskLevel: "MEDIUM",
      evidence: [{ id: "evidence-job", title: "Market snapshot", source: "test", observedAt: timestamp, digest: "sha256:job" }],
    },
  });
  await jobs.createJob({
    id: "job-1", agentId: "agent-job", caseId: "case-job", runId: null, idempotencyKey: "decision-1",
    refreshEvidence: false, status: "QUEUED", stage: "QUEUED", attemptCount: 0, maxAttempts: 3,
    generation: 0, leaseOwner: null, leaseExpiresAt: null, error: null,
    createdAt: timestamp, updatedAt: timestamp, completedAt: null,
  });
  const worker = createCourtJobWorker({ jobs, cases, evidenceProvider: createMockEvidenceProvider(), courtProvider: createMockCourtProvider() });
  assert.equal(await worker.runOnce(), true);
  const completed = await jobs.getJob("job-1", "agent-job");
  assert.equal(completed?.status, "COMPLETED");
  assert.ok(completed?.runId);
  assert.ok(await cases.getReport(completed!.runId!, "agent-job"));
  await Promise.all([jobs.close(), cases.close()]);
});

test("job API deduplicates submissions and exposes completed progress to its owner", async () => {
  const cases = createMemoryCaseRepository();
  const jobs = createMemoryCourtJobRepository();
  const evidenceProvider = createMockEvidenceProvider();
  const courtProvider = createMockCourtProvider();
  const app = await buildApp({ auth, repository: cases, jobRepository: jobs, evidenceProvider, courtProvider });
  const registration = await app.inject({
    method: "POST", url: "/v1/agents/register",
    headers: { "x-cerebra-registration-token": registrationToken }, payload: { name: "Queue Agent" },
  });
  const headers = { authorization: "Bearer " + registration.json().apiKey };
  const created = await app.inject({
    method: "POST", url: "/v1/cases", headers,
    payload: {
      proposal: { asset: "ETHUSDT", market: "spot", timeframe: "1h", summary: "Evaluate a bounded ETH thesis through the durable queue." },
      riskLevel: "MEDIUM", evidenceMode: "MANUAL",
      evidence: [{ id: "queue-evidence", title: "Queue snapshot", source: "test", observedAt: "2026-09-18T00:00:00.000Z", digest: "sha256:queue" }],
    },
  });
  const request = { method: "POST" as const, url: `/v1/cases/${created.json().id}/jobs`, headers: { ...headers, "idempotency-key": "queue-operation-1" }, payload: { refreshEvidence: false } };
  const first = await app.inject(request);
  const duplicate = await app.inject(request);
  assert.equal(first.statusCode, 202);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json().id, first.json().id);

  const worker = createCourtJobWorker({ jobs, cases, evidenceProvider, courtProvider });
  await worker.runOnce();
  const progress = await app.inject({ method: "GET", url: "/v1/jobs/" + first.json().id, headers });
  assert.equal(progress.statusCode, 200);
  assert.equal(progress.json().status, "COMPLETED");
  assert.ok(progress.json().runId);
  await app.close();
});
