export type Vote = 'APPROVE' | 'REJECT' | 'ABSTAIN';
export type OpinionType = 'MAJORITY' | 'DISSENT' | 'ABSTENTION' | 'SEPARATE_OPINION' | 'UNAVAILABLE';
export type Evidence = { id: string; title: string; source: string; observedAt: string; digest: string; summary?: string };
export type JudgeOpinion = {
  judgeId: string; lens: 'RISK' | 'EVIDENCE' | 'STRATEGY'; opinionType: OpinionType;
  vote: Vote | null; confidence: number | null; reasonCode: string | null;
  rationale: string; evidenceIds: string[]; alternativeVote?: Vote | null;
};
export type Direction = 'LONG' | 'SHORT' | 'EITHER';
export type RulingReport = {
  reportId: string; generatedAt: string;
  proposal: { id: string; summary: string; hash: string };
  status: string; verdict: 'APPROVE' | 'REJECT' | null;
  tally: { approve: number; reject: number; abstain: number; unavailable: number };
  judges: [JudgeOpinion, JudgeOpinion, JudgeOpinion];
  dissentingJudgeIds: string[]; evidence: Evidence[];
  recommendation: {
    status: 'ACTIONABLE' | 'WAIT' | 'NO_TRADE'; direction: 'LONG' | 'SHORT' | 'NEUTRAL'; timing: string;
    rationale: string; conditions: string[]; invalidation: string; disclaimer: string;
    source?: 'SUBMITTED' | 'ALTERNATIVE' | 'NONE';
    entryPrice?: number | null; stopPrice?: number | null; targetPrice?: number | null; rewardRisk?: number | null;
  };
  alternativeTally?: { approve: number; reject: number; abstain: number } | null;
  betterLevel?: {
    direction: 'LONG' | 'SHORT'; entryPrice: number; stopPrice: number; targetPrice: number; rewardRisk: number; lastPrice: number;
    judges: string[]; reasons: string[]; instruction: string; disclaimer: string;
  } | null;
  learning?: {
    scope: 'AGENT' | 'COURT'; resolvedOutcomes: number; confirmed: number; refuted: number; sameAssetPrecedents: number;
    agentMemory?: { strategyVersion: number | null; freshBeliefs: number; staleBeliefs: number; undatedBeliefs: number } | null;
  } | null;
  integrity?: { errors: string[]; warnings?: string[] };
};
export type CourtRunResult = {
  runId: string; startedAt: string; completedAt: string;
  provider: string; model: string;
  analystCase: {
    recommendation: 'APPROVE' | 'REJECT'; marketBias?: 'LONG' | 'SHORT' | 'NEUTRAL'; confidence: number; thesis: string;
    keyClaims: Array<{ claim: string; evidenceIds: string[] }>; risks: string[];
  };
  challenge: {
    conclusion: string; confidence: number;
    objections: Array<{ objection: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; evidenceIds: string[] }>;
    missingEvidence: string[];
  };
  report: RulingReport;
  trace: Array<{
    stage: 'ANALYST' | 'CHALLENGER' | 'JUDGE'; judgeId: string | null; status: 'SUCCEEDED' | 'FAILED';
    provider: string; model: string; error: string | null;
    calibration: { resolved: number; accuracy: number; rawConfidence: number; calibratedConfidence: number } | null;
  }>;
  precedents: Array<{ caseId: string; runId: string; asset: string; verdict: 'APPROVE' | 'REJECT' | null; concludedAt: string }>;
};
export type CaseRecord = {
  id: string; evidenceMode: 'BITGET' | 'MANUAL';
  status: 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED'; createdAt: string;
  submission: {
    proposal: { id?: string; asset: string; market: string; timeframe: string; direction?: Direction; summary: string };
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'; evidence: Evidence[];
  };
};
export type RunPhase = 'IDLE' | 'COLLECTING' | 'ANALYSING' | 'COMPLETE';
export type CourtJob = {
  id: string; caseId: string; runId: string | null;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  stage: string; attemptCount: number; maxAttempts: number; error: string | null;
  createdAt: string; updatedAt: string; completedAt: string | null;
};
export type CourtRunRecord = {
  id: string; caseId: string; status: 'RUNNING' | 'COMPLETED' | 'FAILED'; provider: string; model: string;
  startedAt: string; completedAt: string | null; result: CourtRunResult | null; error: string | null;
};

export type PublicJudge = { judgeId: string; lens: string; vote: 'APPROVE' | 'REJECT' | 'ABSTAIN' | null; confidence: number | null; reasonCode: string | null; rationale: string };
export type PublicScore = {
  kind: 'SIGNAL' | 'REJECTION' | 'NOT_SCORABLE';
  result: 'WIN' | 'LOSS' | 'FLAT' | 'REJECTION_CORRECT' | 'REJECTION_MISSED' | 'NOT_SCORABLE';
  direction: 'LONG' | 'SHORT' | null; entryPrice: number | null; stopPrice: number | null; targetPrice: number | null;
  realizedReturnPct: number | null; basis?: 'TARGET' | 'STOP' | 'DRIFT' | null; horizon: string; note: string; resolvedAt: string;
};
export type PublicEntry = {
  seq: number; slotKey: string; status: 'RULED' | 'MISSED'; source: 'SCHEDULED' | 'BACKFILL';
  asset: string | null; timeframe: string | null; riskLevel: string | null; model: string | null;
  ruledAt: string; missedReason: string | null; thesis: string | null; doctrineVersion: string | null;
  verdict: 'APPROVE' | 'REJECT' | null; panelStatus: string | null;
  tally: { approve: number; reject: number; abstain: number; unavailable: number } | null;
  alternativeTally: { approve: number; reject: number; abstain: number } | null;
  recommendation: {
    status: 'ACTIONABLE' | 'WAIT' | 'NO_TRADE'; direction: 'LONG' | 'SHORT' | 'NEUTRAL'; source: string | null;
    entryPrice: number | null; stopPrice: number | null; targetPrice: number | null; rewardRisk: number | null; rationale: string;
  } | null;
  betterLevel: { direction: 'LONG' | 'SHORT'; entryPrice: number; instruction: string } | null;
  judges: PublicJudge[]; dataFreshness: string | null; evidenceObservedAt: string | null;
  score: PublicScore | null;
  hashes: { reportDigest: string | null; entryHash: string; prevHash: string };
  createdAt: string;
};
export type PublicTrackRecord = {
  since: string | null; rulings: number; missedSlots: number; approved: number; rejected: number; actionable: number; pendingScore: number;
  signals: { scored: number; wins: number; losses: number; flat: number; winsByDrift: number; lossesByDrift: number; winRatePct: number | null; averageReturnPct: number | null };
  rejections: { scored: number; correct: number; missed: number; accuracyPct: number | null };
  notScorable: number;
  chain: { valid: boolean; headSeq: number | null; headHash: string | null };
  note: string;
};
export type PublicVerification = { valid: boolean; checked: number; headSeq: number | null; headHash: string | null; firstBrokenSeq: number | null; problem: string | null };

const agentKeyStorage = 'cerebra.agent-key.v1';

export function getSessionAgentKey() {
  return typeof window === 'undefined' ? null : window.sessionStorage.getItem(agentKeyStorage);
}

export function saveSessionAgentKey(apiKey: string) {
  window.sessionStorage.setItem(agentKeyStorage, apiKey);
}

export function clearSessionAgentKey() {
  window.sessionStorage.removeItem(agentKeyStorage);
}

export async function cerebraApi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  if (!headers.has('authorization')) {
    const apiKey = getSessionAgentKey();
    if (apiKey) headers.set('x-cerebra-agent-key', apiKey);
  }
  const response = await fetch('/api/cerebra' + path, { ...init, headers });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
      ? body.message
      : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return body as T;
}

export function agentHeaders(apiKey: string): HeadersInit {
  return { 'x-cerebra-agent-key': apiKey };
}

export function shortDate(value: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
