import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("health and metadata endpoints expose the court topology", async () => {
  const app = await buildApp();
  const health = await app.inject({ method: "GET", url: "/health/ready" });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: "ready" });

  const meta = await app.inject({ method: "GET", url: "/v1/meta" });
  assert.equal(meta.statusCode, 200);
  assert.deepEqual(meta.json().topology.judges, [
    "judge-risk",
    "judge-evidence",
    "judge-strategy",
  ]);
  await app.close();
});

test("MCP endpoint exposes Cerebra tools", async () => {
  const app = await buildApp();
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch("http://127.0.0.1:" + address.port + "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /cerebra_status/);
  assert.match(body, /cerebra_create_case/);
  assert.match(body, /cerebra_run_court/);
  assert.match(body, /cerebra_get_report/);
  assert.match(body, /cerebra_enqueue_court/);
  assert.match(body, /cerebra_get_job/);
  assert.match(body, /cerebra_save_strategy/);
  assert.match(body, /cerebra_recall_memory/);
  assert.match(body, /cerebra_save_checkpoint/);
  assert.match(body, /court_tally_preview/);
  await app.close();
});

test("court-run endpoint returns Analyst, Challenger, votes, and dissent", async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/court/runs",
    payload: {
      proposal: {
        id: "eth-proposal",
        asset: "ETHUSDT",
        market: "spot",
        timeframe: "1h",
        summary: "Evaluate a provisional ETH long thesis over the next hour.",
      },
      riskLevel: "MEDIUM",
      evidence: [{
        id: "eth-evidence-1",
        title: "Synthetic ETH snapshot",
        source: "api-test",
        observedAt: "2026-09-17T10:00:00.000Z",
        digest: "sha256:eth-test",
      }],
    },
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.provider, "mock");
  assert.equal(body.analystCase.recommendation, "APPROVE");
  assert.ok(body.challenge.objections.length > 0);
  assert.equal(body.report.judges.length, 3);
  assert.deepEqual(body.report.dissentingJudgeIds, ["judge-risk"]);
  await app.close();
});

test("court-run endpoint rejects cases without evidence", async () => {
  const app = await buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/court/runs",
    payload: {
      proposal: {
        asset: "BTCUSDT",
        timeframe: "4h",
        summary: "Evaluate a BTC proposal without any supporting evidence.",
      },
      riskLevel: "HIGH",
      evidence: [],
    },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "INVALID_CASE_SUBMISSION");
  await app.close();
});
