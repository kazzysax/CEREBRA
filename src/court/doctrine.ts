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
export const advisoryDoctrineV1: CourtDoctrine = {
  id: "cerebra-advisory-doctrine",
  version: "v1",
  title: "Evidence before execution",
  principles: [
    "Cerebra gives advisory reports, never trading instructions or guarantees.",
    "A conclusion must be grounded in supplied, attributable evidence; uncertainty must be named.",
    "A proposed execution needs an entry thesis, a defined invalidation condition, and a plausible downside assessment.",
    "Static market snapshots can support an observation but cannot by themselves prove future execution quality.",
    "Material disagreement and missing evidence must remain visible in the final report.",
  ],
  judgeMandates: {
    "judge-risk": [
      "Assess downside, invalidation, liquidity, volatility, and adverse-selection risk.",
      "Reject support when risk cannot be bounded from the supplied evidence.",
    ],
    "judge-evidence": [
      "Assess evidence freshness, attribution, corroboration, contradictions, and material gaps.",
      "Do not treat one static source as confirmation of a claim that requires observation over time.",
    ],
    "judge-strategy": [
      "Assess whether the thesis, timing, market regime, and execution plan are coherent together.",
      "Require a plausible invalidation condition before supporting an execution thesis.",
    ],
  },
};
