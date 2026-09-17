import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

const registrationToken = "test-registration-token-that-is-long-enough";
const authOptions = {
  mode: "agent-key" as const,
  apiKeyPepper: "test-agent-key-pepper-that-is-long-enough",
  registrationToken,
};

async function register(app: Awaited<ReturnType<typeof buildApp>>, name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/agents/register",
    headers: { "x-cerebra-registration-token": registrationToken },
    payload: { name, capabilities: ["stock-research"] },
  });
  assert.equal(response.statusCode, 201);
  return response.json() as { agent: { id: string; keyHash?: string }; apiKey: string };
}

test("agent identity issues one-time keys and protects authenticated routes", async () => {
  const app = await buildApp({ auth: authOptions });

  const forbidden = await app.inject({
    method: "POST",
    url: "/v1/agents/register",
    payload: { name: "Untrusted Agent" },
  });
  assert.equal(forbidden.statusCode, 403);

  const registered = await register(app, "Research Agent");
  assert.match(registered.apiKey, /^cba_live_/);
  assert.equal(registered.agent.keyHash, undefined);

  const missingKey = await app.inject({ method: "GET", url: "/v1/cases" });
  assert.equal(missingKey.statusCode, 401);

  const profile = await app.inject({
    method: "GET",
    url: "/v1/agents/me",
    headers: { authorization: "Bearer " + registered.apiKey },
  });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().id, registered.agent.id);

  await app.close();
});

test("rotated keys are invalidated and case data is isolated by agent", async () => {
  const app = await buildApp({ auth: authOptions });
  const first = await register(app, "Alpha Agent");
  const second = await register(app, "Beta Agent");

  const created = await app.inject({
    method: "POST",
    url: "/v1/cases",
    headers: { authorization: "Bearer " + first.apiKey },
    payload: {
      proposal: {
        asset: "BTCUSDT",
        market: "spot",
        timeframe: "4h",
        summary: "Evaluate a bounded BTC allocation using supplied market evidence.",
      },
      riskLevel: "MEDIUM",
      evidenceMode: "MANUAL",
      evidence: [{
        id: "ev-1",
        title: "BTC market snapshot",
        source: "identity-test",
        observedAt: "2026-09-18T00:00:00.000Z",
        digest: "sha256:identity-test",
      }],
    },
  });
  assert.equal(created.statusCode, 201);
  const caseId = created.json().id as string;

  const hidden = await app.inject({
    method: "GET",
    url: "/v1/cases/" + caseId,
    headers: { authorization: "Bearer " + second.apiKey },
  });
  assert.equal(hidden.statusCode, 404);

  const rotated = await app.inject({
    method: "POST",
    url: "/v1/agents/me/keys/rotate",
    headers: { authorization: "Bearer " + first.apiKey },
  });
  assert.equal(rotated.statusCode, 201);
  const nextKey = rotated.json().apiKey as string;

  const oldKey = await app.inject({
    method: "GET",
    url: "/v1/cases/" + caseId,
    headers: { authorization: "Bearer " + first.apiKey },
  });
  assert.equal(oldKey.statusCode, 401);

  const owner = await app.inject({
    method: "GET",
    url: "/v1/cases/" + caseId,
    headers: { authorization: "Bearer " + nextKey },
  });
  assert.equal(owner.statusCode, 200);
  assert.equal(owner.json().agentId, first.agent.id);

  await app.close();
});
