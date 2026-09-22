import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

const manualEvidenceCase = {
  proposal: {
    asset: "BTCUSDT", market: "spot", timeframe: "4h",
    summary: "Rate limit test: evaluate a provisional BTC long thesis.",
  },
  riskLevel: "MEDIUM" as const,
  evidenceMode: "MANUAL" as const,
  evidence: [{
    id: "ev-1", title: "BTC snapshot", source: "test",
    observedAt: "2026-09-22T00:00:00.000Z", digest: "sha256:test",
  }],
};

async function createAnonymousCase(app: Awaited<ReturnType<typeof buildApp>>, ip: string) {
  return app.inject({
    method: "POST",
    url: "/v1/cases",
    headers: { "x-forwarded-for": ip },
    payload: manualEvidenceCase,
  });
}

test("limits repeated anonymous requests from the same address", async () => {
  const app = await buildApp({ anonymousRateLimit: { maxRequests: 3, windowMs: 60_000 } });

  for (let i = 0; i < 3; i += 1) {
    const response = await createAnonymousCase(app, "203.0.113.10");
    assert.equal(response.statusCode, 201, `request ${i} should succeed`);
  }
  const limited = await createAnonymousCase(app, "203.0.113.10");
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error, "ANONYMOUS_RATE_LIMITED");
  assert.ok(limited.headers["retry-after"]);
  await app.close();
});

test("tracks anonymous addresses independently", async () => {
  const app = await buildApp({ anonymousRateLimit: { maxRequests: 1, windowMs: 60_000 } });

  const first = await createAnonymousCase(app, "203.0.113.20");
  assert.equal(first.statusCode, 201);
  const secondSameIp = await createAnonymousCase(app, "203.0.113.20");
  assert.equal(secondSameIp.statusCode, 429);
  const differentIp = await createAnonymousCase(app, "203.0.113.21");
  assert.equal(differentIp.statusCode, 201);
  await app.close();
});

test("resets once the window elapses", async () => {
  let currentTime = 0;
  const app = await buildApp({
    anonymousRateLimit: { maxRequests: 1, windowMs: 1_000, now: () => currentTime },
  });

  const first = await createAnonymousCase(app, "203.0.113.30");
  assert.equal(first.statusCode, 201);
  const limited = await createAnonymousCase(app, "203.0.113.30");
  assert.equal(limited.statusCode, 429);

  currentTime += 1_001;
  const afterReset = await createAnonymousCase(app, "203.0.113.30");
  assert.equal(afterReset.statusCode, 201);
  await app.close();
});

test("never limits requests carrying an agent bearer key", async () => {
  const registrationToken = "test-registration-token-that-is-long-enough";
  const app = await buildApp({
    anonymousRateLimit: { maxRequests: 1, windowMs: 60_000 },
    auth: { mode: "agent-key", apiKeyPepper: "test-agent-key-pepper-that-is-long-enough", registrationToken },
  });
  const registered = await app.inject({
    method: "POST",
    url: "/v1/agents/register",
    headers: { "x-cerebra-registration-token": registrationToken },
    payload: { name: "Rate Limit Test Agent" },
  });
  const apiKey = registered.json().apiKey as string;

  for (let i = 0; i < 3; i += 1) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/cases",
      headers: { authorization: "Bearer " + apiKey, "x-forwarded-for": "203.0.113.40" },
      payload: manualEvidenceCase,
    });
    assert.equal(response.statusCode, 201, `authenticated request ${i} should succeed`);
  }
  await app.close();
});
