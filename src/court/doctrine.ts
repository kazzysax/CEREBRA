import type { JudgeId } from "../domain/contracts.js";

export type CourtDoctrine = {
  id: string;
  version: string;
  title: string;
  principles: readonly string[];
  judgeMandates: Readonly<Record<JudgeId, readonly string[]>>;
};

// This is a versioned product policy, not a hidden prompt. Its complete snapshot
// is attached to every new ruling so an agent can see the standard applied.
//
// v1 told judges that a static snapshot could never support a claim, while the
// only evidence the court ever receives is a market snapshot; every case was
// therefore rejected for "insufficient evidence". v2 judges the measured setup
// on its merits and makes both approval and rejection reachable. v3 adds the
// computed plan standard: live v2 judges rejected clean, in-budget, trend-aligned
// plans for "weak momentum", so every ruling was a rejection in practice. v4
// adds side-neutrality: reference-plan stop labels, price position in the range
// and the funding sign were nudging the Analyst toward fading trends (mostly
// shorts in a rally), so a counter-trend call now needs a specific reversal
// signal and none of those three counts as one.
export const advisoryDoctrineV2: CourtDoctrine = {
  id: "cerebra-advisory-doctrine",
  version: "v4",
  title: "Judge the measured setup, bound the risk",
  principles: [
    "Cerebra gives advisory reports, never trading instructions or guarantees.",
    "The measured market data (trend, returns, volatility, order-book depth, funding, key levels) is valid evidence for a call over the stated horizon. Do not reject a case merely because the evidence is a recent snapshot; judge what it shows.",
    "Claims in the thesis that the data cannot verify (news, earnings, product launches) are unverified context. They neither support nor sink the case by themselves; the call must stand on the measured data.",
    "Support a direction when the measured data agrees with it and the plan has a stop at a defensible level and a reward/risk that meets the court's computed risk budget.",
    "Oppose a direction when the measured data contradicts it, the stop is undefined, inside noise or too wide for the risk posture, or the reward does not justify the risk.",
    "A plan that meets the computed plan standard (valid levels, within the risk budget, not fighting the measured trend) is approved unless a specific measured fact contradicts it. Modest momentum, a mid-range price or a cautious order book lower confidence; they do not by themselves justify rejection. A plan that fails the standard is rejected, naming the failed check.",
    "Only the measured data observed at the snapshot time is current. Saved beliefs, strategies, past rulings and track-record entries marked AGING or STALE describe an older market and are weak context at most; they never override the current measured data.",
    "A better entry level is optional advice, offered only when waiting or taking the other side at a specific measured level would clearly beat the plan on the table, and only if it passes the same risk standard.",
    "Side selection is symmetric. Go with the measured trend by default; a counter-trend call needs a specific reversal signal. Where price sits in its 24h range, which reference stop is labelled STRUCTURAL, and the sign of the funding rate are not reasons to take either side.",
    "Treat the court's computed risk check as fact; do not recompute prices or ratios from raw arrays.",
    "Confidence is a probability: 0.5 means a coin flip, 0.6-0.75 a real but ordinary edge, above 0.85 only for strong agreement across trend, flow and levels.",
    "Learn from the track record: if the court was wrong on this asset or in this direction recently, say what is different now or lower confidence.",
  ],
  judgeMandates: {
    "judge-risk": [
      "Assess whether the downside is bounded: stop placement in ATR terms, reward/risk against the risk budget, funding cost, spread and liquidity.",
      "Oppose when the computed risk check fails the budget or the stop is missing; support when risk is bounded and the payoff justifies it.",
    ],
    "judge-evidence": [
      "Assess whether the measured data actually says what the thesis and Analyst claim: trend, momentum, depth, levels.",
      "Oppose claims the data contradicts; do not oppose merely because unverifiable context was mentioned alongside a data-supported call.",
    ],
    "judge-strategy": [
      "Assess whether direction, horizon, entry, stop and target form a coherent plan for the current regime (trend vs range).",
      "Support coherent plans that trade with the measured structure or fade it with tight, well-placed risk; oppose incoherent or contradictory plans.",
    ],
  },
};

