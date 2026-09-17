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
  provider: string; model: string; report: RulingReport;
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
  runId: 'run-demo-btc-4h', startedAt: '2026-09-17T08:36:12.000Z', completedAt: '2026-09-17T08:36:26.000Z',
  provider: 'claude', model: 'claude-sonnet',
  report: {
    reportId: 'report-demo-btc-4h', generatedAt: '2026-09-17T08:36:26.000Z',
    proposal: { id: 'btc-long-4h', summary: 'Evaluate a provisional BTC long thesis over the next four hours.', hash: 'sha256:demo' },
    status: 'SUPPORTED', verdict: 'APPROVE', tally: { approve: 2, reject: 1, abstain: 0, unavailable: 0 },
    dissentingJudgeIds: ['judge-risk'],
    evidence: [{ id: 'bitget:tickers:BTCUSDT', title: 'Bitget BTCUSDT ticker snapshot', source: 'bitget-agent-sdk', observedAt: '2026-09-17T08:36:12.000Z', digest: 'sha256:9934e2', summary: 'Spot ticker, order-book depth and 24 recent 4H candles verified.' }],
    judges: [
      { judgeId: 'judge-risk', lens: 'RISK', opinionType: 'DISSENT', vote: 'REJECT', confidence: 0.78, reasonCode: 'RISK_EXCESSIVE', rationale: 'The proposal does not define a hard invalidation level, leaving downside exposure insufficiently bounded if liquidity deteriorates.', evidenceIds: ['bitget:tickers:BTCUSDT'] },
      { judgeId: 'judge-evidence', lens: 'EVIDENCE', opinionType: 'MAJORITY', vote: 'APPROVE', confidence: 0.74, reasonCode: 'EVIDENCE_SUFFICIENT', rationale: 'The cited ticker, order book and candle set are traceable and sufficient for a provisional advisory ruling.', evidenceIds: ['bitget:tickers:BTCUSDT'] },
      { judgeId: 'judge-strategy', lens: 'STRATEGY', opinionType: 'MAJORITY', vote: 'APPROVE', confidence: 0.7, reasonCode: 'STRATEGY_COHERENT', rationale: 'The time horizon and directional thesis are coherent when paired with explicit monitoring and controlled position size.', evidenceIds: ['bitget:tickers:BTCUSDT'] },
    ],
  },
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
