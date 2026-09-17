export type Vote = 'APPROVE' | 'REJECT' | 'ABSTAIN';
export type OpinionType = 'MAJORITY' | 'DISSENT' | 'ABSTENTION' | 'SEPARATE_OPINION' | 'UNAVAILABLE';
export type Evidence = { id: string; title: string; source: string; observedAt: string; digest: string; summary?: string };
export type JudgeOpinion = {
  judgeId: string; lens: 'RISK' | 'EVIDENCE' | 'STRATEGY'; opinionType: OpinionType;
  vote: Vote | null; confidence: number | null; reasonCode: string | null;
  rationale: string; evidenceIds: string[];
};
export type RulingReport = {
  reportId: string; generatedAt: string;
  proposal: { id: string; summary: string; hash: string };
  status: string; verdict: 'APPROVE' | 'REJECT' | null;
  tally: { approve: number; reject: number; abstain: number; unavailable: number };
  judges: [JudgeOpinion, JudgeOpinion, JudgeOpinion];
  dissentingJudgeIds: string[]; evidence: Evidence[];
};
export type CourtRunResult = {
  runId: string; startedAt: string; completedAt: string;
  provider: string; model: string;
  analystCase: {
    recommendation: 'APPROVE' | 'REJECT'; confidence: number; thesis: string;
    keyClaims: Array<{ claim: string; evidenceIds: string[] }>; risks: string[];
  };
  challenge: {
    conclusion: string; confidence: number;
    objections: Array<{ objection: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; evidenceIds: string[] }>;
    missingEvidence: string[];
  };
  report: RulingReport;
  trace: Array<{ stage: 'ANALYST' | 'CHALLENGER' | 'JUDGE'; judgeId: string | null; status: 'SUCCEEDED' | 'FAILED'; provider: string; model: string; error: string | null }>;
};
export type CaseRecord = {
  id: string; evidenceMode: 'BITGET' | 'MANUAL';
  status: 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED'; createdAt: string;
  submission: {
    proposal: { id?: string; asset: string; market: string; timeframe: string; summary: string };
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'; evidence: Evidence[];
  };
};
export type RunPhase = 'IDLE' | 'COLLECTING' | 'ANALYSING' | 'COMPLETE';

export const sampleReport: CourtRunResult = {
  runId: 'run-demo-tsla-4h', startedAt: '2026-09-17T08:36:12.000Z', completedAt: '2026-09-17T08:36:26.000Z',
  provider: 'claude', model: 'claude-sonnet',
  analystCase: {
    recommendation: 'APPROVE', confidence: 0.74,
    thesis: 'TSLA retains constructive four-hour momentum, but the position should remain provisional because the tokenized session can diverge from the primary U.S. listing.',
    keyClaims: [
      { claim: 'Recent candles preserve the short-horizon directional structure.', evidenceIds: ['bitget:tickers:TSLAUSDT'] },
      { claim: 'Current order-book depth can support a controlled advisory position size.', evidenceIds: ['bitget:tickers:TSLAUSDT'] },
    ],
    risks: ['Tokenized after-hours liquidity may thin rapidly.', 'The thesis lacks a confirmed catalyst from the primary U.S. session.'],
  },
  challenge: {
    conclusion: 'The supporting case is directionally coherent but understates liquidity divergence and does not define a hard price invalidation.',
    confidence: 0.82,
    objections: [
      { objection: 'The evidence packet does not compare the tokenized quote with the latest primary-market close.', severity: 'HIGH', evidenceIds: ['bitget:tickers:TSLAUSDT'] },
      { objection: 'Approval without a numeric invalidation level leaves the downside boundary ambiguous.', severity: 'HIGH', evidenceIds: [] },
    ],
    missingEvidence: ['Primary-listing reference price', 'Upcoming earnings or macro catalyst check', 'Explicit entry, invalidation and maximum-loss levels'],
  },
  report: {
    reportId: 'report-demo-tsla-4h', generatedAt: '2026-09-17T08:36:26.000Z',
    proposal: { id: 'tsla-long-4h', summary: 'Evaluate a provisional TSLA long thesis across the next four hours of the tokenized trading session.', hash: 'sha256:demo' },
    status: 'SUPPORTED', verdict: 'APPROVE', tally: { approve: 2, reject: 1, abstain: 0, unavailable: 0 },
    dissentingJudgeIds: ['judge-risk'],
    evidence: [{ id: 'bitget:tickers:TSLAUSDT', title: 'Bitget TSLA tokenized-market snapshot', source: 'bitget-agent-sdk', observedAt: '2026-09-17T08:36:12.000Z', digest: 'sha256:9934e2', summary: 'Tokenized-stock ticker, order-book depth and 24 recent 4H candles verified.' }],
    judges: [
      { judgeId: 'judge-risk', lens: 'RISK', opinionType: 'DISSENT', vote: 'REJECT', confidence: 0.78, reasonCode: 'RISK_EXCESSIVE', rationale: 'The thesis lacks a hard invalidation level and does not fully price the thinner liquidity of the tokenized after-hours session.', evidenceIds: ['bitget:tickers:TSLAUSDT'] },
      { judgeId: 'judge-evidence', lens: 'EVIDENCE', opinionType: 'MAJORITY', vote: 'APPROVE', confidence: 0.74, reasonCode: 'EVIDENCE_SUFFICIENT', rationale: 'The Bitget quote, order-book depth and recent candle set are traceable and sufficient for a provisional human-reviewed ruling.', evidenceIds: ['bitget:tickers:TSLAUSDT'] },
      { judgeId: 'judge-strategy', lens: 'STRATEGY', opinionType: 'MAJORITY', vote: 'APPROVE', confidence: 0.7, reasonCode: 'STRATEGY_COHERENT', rationale: 'The four-hour thesis is coherent when paired with controlled size, a defined exit and continuous monitoring of the tokenized session.', evidenceIds: ['bitget:tickers:TSLAUSDT'] },
    ],
  },
  trace: [
    { stage: 'ANALYST', judgeId: null, status: 'SUCCEEDED', provider: 'claude', model: 'claude-sonnet', error: null },
    { stage: 'CHALLENGER', judgeId: null, status: 'SUCCEEDED', provider: 'claude', model: 'claude-sonnet', error: null },
    { stage: 'JUDGE', judgeId: 'judge-risk', status: 'SUCCEEDED', provider: 'claude', model: 'claude-sonnet', error: null },
    { stage: 'JUDGE', judgeId: 'judge-evidence', status: 'SUCCEEDED', provider: 'claude', model: 'claude-sonnet', error: null },
    { stage: 'JUDGE', judgeId: 'judge-strategy', status: 'SUCCEEDED', provider: 'claude', model: 'claude-sonnet', error: null },
  ],
};

export async function cerebraApi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
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

export function shortDate(value: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
