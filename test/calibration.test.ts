import assert from "node:assert/strict";
import test from "node:test";
import { calibrateConfidence } from "../src/court/calibration.js";

test("leaves confidence untouched when there is no calibration record", () => {
  assert.equal(calibrateConfidence(0.8, undefined), null);
});

test("leaves confidence untouched below the resolved-outcome threshold", () => {
  const thin = { judgeId: "judge-risk" as const, resolved: 2, correct: 1, incorrect: 1, accuracy: 0.5 };
  assert.equal(calibrateConfidence(0.8, thin), null);
});

test("leaves confidence untouched when nothing has resolved yet", () => {
  const untested = { judgeId: "judge-risk" as const, resolved: 0, correct: 0, incorrect: 0, accuracy: null };
  assert.equal(calibrateConfidence(0.8, untested), null);
});

test("shrinks confidence toward a poor track record once enough outcomes resolved", () => {
  const poor = { judgeId: "judge-risk" as const, resolved: 3, correct: 0, incorrect: 3, accuracy: 0 };
  const adjustment = calibrateConfidence(0.78, poor);
  assert.ok(adjustment);
  // weight = 0.4 * 3 / (3 + 5) = 0.15; blended = 0.78 * 0.85 + 0 * 0.15 = 0.663
  assert.equal(adjustment!.weight, 0.15);
  assert.equal(adjustment!.calibratedConfidence, 0.663);
  assert.equal(adjustment!.rawConfidence, 0.78);
  assert.ok(adjustment!.calibratedConfidence < adjustment!.rawConfidence);
});

test("pulls confidence upward toward a strong track record", () => {
  const strong = { judgeId: "judge-evidence" as const, resolved: 10, correct: 10, incorrect: 0, accuracy: 1 };
  const adjustment = calibrateConfidence(0.6, strong);
  assert.ok(adjustment);
  // weight = 0.4 * 10 / 15 = 0.2667; blended = 0.6 * 0.7333 + 1 * 0.2667 = 0.7067
  assert.equal(adjustment!.calibratedConfidence, 0.707);
  assert.ok(adjustment!.calibratedConfidence > adjustment!.rawConfidence);
});

test("more resolved history pulls harder toward the track record, up to the shrinkage cap", () => {
  const modest = { judgeId: "judge-risk" as const, resolved: 3, correct: 0, incorrect: 3, accuracy: 0 };
  const deep = { judgeId: "judge-risk" as const, resolved: 200, correct: 0, incorrect: 200, accuracy: 0 };
  const modestAdjustment = calibrateConfidence(0.9, modest)!;
  const deepAdjustment = calibrateConfidence(0.9, deep)!;
  assert.ok(deepAdjustment.weight > modestAdjustment.weight);
  assert.ok(deepAdjustment.calibratedConfidence < modestAdjustment.calibratedConfidence);
  assert.ok(deepAdjustment.weight < 0.4);
});

test("never pushes confidence outside [0, 1]", () => {
  const worst = { judgeId: "judge-risk" as const, resolved: 500, correct: 0, incorrect: 500, accuracy: 0 };
  const adjustment = calibrateConfidence(0.05, worst)!;
  assert.ok(adjustment.calibratedConfidence >= 0);
  assert.ok(adjustment.calibratedConfidence <= 1);
});
