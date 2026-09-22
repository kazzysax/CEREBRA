import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

const registrationToken = "test-registration-token-that-is-long-enough";
const authOptions = {
  mode: "agent-key" as const,
  apiKeyPepper: "test-agent-key-pepper-that-is-long-enough",
  registrationToken,
};

type App = Awaited<ReturnType<typeof buildApp>>;

async function register(app: App, name: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/agents/register",
    headers: { "x-cerebra-registration-token": registrationToken },
    payload: { name, capabilities: ["stock-research"] },
  });
  assert.equal(response.statusCode, 201);
  return response.json().apiKey as string;
}

async function createAndRunCase(app: App, apiKey: string, observedAt: string) {
  const created = await app.inject({
    method: "POST",
    url: "/v1/cases",
    headers: { authorization: "Bearer " + apiKey },
    payload: {
      proposal: {
        asset: "BTCUSDT",
        market: "spot",
        timeframe: "4h",
        summary: "Evaluate a provisional BTC long thesis using manually supplied evidence.",
      },
      riskLevel: "MEDIUM",
      evidenceMode: "MANUAL",
      evidence: [{
        id: "ev-1",
        title: "BTC market snapshot",
        source: "feedback-loop-test",
        observedAt,
        digest: "sha256:feedback-loop-test",
      }],
    },
  });
  assert.equal(created.statusCode, 201);

  const run = await app.inject({
    method: "POST",
    url: "/v1/cases/" + created.json().id + "/run",
    headers: { authorization: "Bearer " + apiKey },
    payload: { refreshEvidence: false },
  });
  assert.equal(run.statusCode, 201);
  return run.json() as {
    runId: string;
    report: { judges: Array<{ judgeId: string; confidence: number | null; rationale: string }> };
  };
}

async function recordOutcome(app: App, apiKey: string, runId: string, observedAt: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/runs/" + runId + "/outcomes",
    headers: { authorization: "Bearer " + apiKey },
    payload: {
      horizon: "4h",
      thesisOutcome: "CONFIRMED",
      observedAt,
    },
  });
  assert.equal(response.statusCode, 201);
}

test("post-trade outcomes feed back into a judge's confidence on the next ruling", async () => {
  const app = await buildApp({ auth: authOptions });
  const apiKey = await register(app, "Feedback Loop Agent");

  // Baseline: with no resolved outcomes yet, the mock judges report their raw confidence untouched.
  const baseline = await createAndRunCase(app, apiKey, "2026-09-20T10:00:00.000Z");
  const baselineRisk = baseline.report.judges.find((judge) => judge.judgeId === "judge-risk")!;
  const baselineEvidence = baseline.report.judges.find((judge) => judge.judgeId === "judge-evidence")!;
  assert.equal(baselineRisk.confidence, 0.78);
  assert.equal(baselineEvidence.confidence, 0.74);

  // The mock judge-risk always votes REJECT and judge-evidence/judge-strategy always vote APPROVE.
  // Recording a CONFIRMED outcome after each of three rulings makes judge-risk wrong every time
  // and the other two judges right every time, giving each judge a real, resolved track record.
  const rulingsToResolve = [
    baseline,
    await createAndRunCase(app, apiKey, "2026-09-20T11:00:00.000Z"),
    await createAndRunCase(app, apiKey, "2026-09-20T12:00:00.000Z"),
  ];
  for (const [index, ruling] of rulingsToResolve.entries()) {
    await recordOutcome(app, apiKey, ruling.runId, "2026-09-20T1" + (index + 3) + ":00:00.000Z");
  }

  const calibration = await app.inject({
    method: "GET",
    url: "/v1/judges/calibration",
    headers: { authorization: "Bearer " + apiKey },
  });
  assert.equal(calibration.statusCode, 200);
  const judges = calibration.json().judges as Array<
    { judgeId: string; resolved: number; correct: number; incorrect: number; accuracy: number | null }
  >;
  assert.deepEqual(judges.find((judge) => judge.judgeId === "judge-risk"), {
    judgeId: "judge-risk", resolved: 3, correct: 0, incorrect: 3, accuracy: 0,
  });
  assert.deepEqual(judges.find((judge) => judge.judgeId === "judge-evidence"), {
    judgeId: "judge-evidence", resolved: 3, correct: 3, incorrect: 0, accuracy: 1,
  });

  // A brand-new case for the same agent should now carry that track record into the ruling:
  // judge-risk's history-blind confidence gets throttled down, judge-evidence's gets pulled up.
  const calibrated = await createAndRunCase(app, apiKey, "2026-09-20T16:00:00.000Z");
  const calibratedRisk = calibrated.report.judges.find((judge) => judge.judgeId === "judge-risk")!;
  const calibratedEvidence = calibrated.report.judges.find((judge) => judge.judgeId === "judge-evidence")!;
  const calibratedStrategy = calibrated.report.judges.find((judge) => judge.judgeId === "judge-strategy")!;

  assert.equal(calibratedRisk.confidence, 0.663);
  assert.ok(calibratedRisk.confidence! < baselineRisk.confidence!);
  assert.match(calibratedRisk.rationale, /Confidence calibrated from 0\.78 to 0\.663 using 3 resolved outcomes; historical accuracy 0%/);

  assert.equal(calibratedEvidence.confidence, 0.779);
  assert.ok(calibratedEvidence.confidence! > baselineEvidence.confidence!);
  assert.match(calibratedEvidence.rationale, /historical accuracy 100%/);

  assert.equal(calibratedStrategy.confidence, 0.745);

  await app.close();
});
