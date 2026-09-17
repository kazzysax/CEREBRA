'use client';
/* oxlint-disable react/react-compiler */

import { SyntheticEvent, useEffect, useState } from 'react';
import { Activity, ArrowRight, ChevronRight, CircleAlert, Database, Download, Fingerprint, Gavel, LoaderCircle, Menu, Plus, Radio, RefreshCw, Scale, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { BrandMark, Dissent, JudgeCard, Pipeline } from '@/components/court-panel';
import { cerebraApi, sampleReport, shortDate, type CaseRecord, type CourtRunResult, type RunPhase } from '@/lib/cerebra';

const sampleCases = [
  { id: 'sample-btc', asset: 'BTCUSDT', status: 'APPROVED', time: '12m', votes: '2–1' },
  { id: 'sample-eth', asset: 'ETHUSDT', status: 'REJECTED', time: '1h', votes: '1–2' },
  { id: 'sample-sol', asset: 'SOLUSDT', status: 'INCONCLUSIVE', time: '3h', votes: '1–1' },
];

type CourtInput = {
  asset: string;
  market: string;
  timeframe: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: string;
};

type WebMcpContext = {
  registerTool: (tool: {
    name: string;
    title: string;
    description: string;
    inputSchema: object;
    annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
    execute: (input: unknown) => Promise<unknown>;
  }, options: { signal: AbortSignal }) => void | Promise<void>;
};

function statusTone(status: string) {
  if (['APPROVED', 'COMPLETED', 'SUPPORTED'].includes(status)) return 'positive';
  if (['REJECTED', 'FAILED'].includes(status)) return 'negative';
  return 'neutral';
}

export default function Home() {
  const [asset, setAsset] = useState('BTCUSDT');
  const [market, setMarket] = useState('spot');
  const [timeframe, setTimeframe] = useState('4h');
  const [riskLevel, setRiskLevel] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [summary, setSummary] = useState('Evaluate a provisional BTC long thesis over the next four hours.');
  const [phase, setPhase] = useState<RunPhase>('IDLE');
  const [result, setResult] = useState<CourtRunResult>(sampleReport);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const isRunning = phase === 'COLLECTING' || phase === 'ANALYSING';
  const verdict = result.report.verdict ?? 'NO VERDICT';

  async function loadCases() {
    try {
      const response = await cerebraApi<{ cases: CaseRecord[] }>('/v1/cases?limit=12');
      setCases(response.cases);
      setConnected(true);
    } catch { setConnected(false); }
  }

  useEffect(() => {
    queueMicrotask(() => void loadCases());
    const context = (document as Document & { modelContext?: WebMcpContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: 'create_cerebra_case_and_run_court',
      title: 'Convene Cerebra court',
      description: 'Create a market thesis case, gather Bitget evidence, run the multi-agent court, and return its verdict and dissent.',
      inputSchema: {
        type: 'object',
        properties: {
          asset: { type: 'string', description: 'Trading symbol such as BTCUSDT.' },
          market: { type: 'string', enum: ['spot', 'usdt-futures'] },
          timeframe: { type: 'string', enum: ['15m', '1h', '4h', '1d'] },
          riskLevel: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          summary: { type: 'string', minLength: 10, description: 'The decision thesis to put before the court.' },
        },
        required: ['asset', 'market', 'timeframe', 'riskLevel', 'summary'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(value) {
        if (!value || typeof value !== 'object') throw new Error('A case input object is required.');
        const candidate = value as Record<string, unknown>;
        if (typeof candidate.asset !== 'string' || typeof candidate.summary !== 'string' || candidate.summary.trim().length < 10) {
          throw new Error('asset and a summary of at least 10 characters are required.');
        }
        if (!['spot', 'usdt-futures'].includes(String(candidate.market)) || !['15m', '1h', '4h', '1d'].includes(String(candidate.timeframe)) || !['LOW', 'MEDIUM', 'HIGH'].includes(String(candidate.riskLevel))) {
          throw new Error('market, timeframe, or riskLevel is invalid.');
        }
        const courtInput = candidate as unknown as CourtInput;
        const run = await executeCourt(courtInput);
        return { runId: run.runId, verdict: run.report.verdict, status: run.report.status, dissentingJudgeIds: run.report.dissentingJudgeIds };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  async function executeCourt(input: CourtInput) {
    setAsset(input.asset.toUpperCase());
    setMarket(input.market);
    setTimeframe(input.timeframe);
    setRiskLevel(input.riskLevel);
    setSummary(input.summary);
    setError(null);
    setPhase('COLLECTING');
    try {
      const created = await cerebraApi<CaseRecord>('/v1/cases', {
        method: 'POST',
        body: JSON.stringify({ proposal: { asset: input.asset.trim().toUpperCase(), market: input.market, timeframe: input.timeframe, summary: input.summary.trim() }, riskLevel: input.riskLevel, evidenceMode: 'BITGET' }),
      });
      setCases((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setConnected(true);
      setPhase('ANALYSING');
      const run = await cerebraApi<CourtRunResult>(`/v1/cases/${created.id}/run`, { method: 'POST', body: JSON.stringify({ refreshEvidence: false }) });
      setResult(run);
      setPhase('COMPLETE');
      await loadCases();
      return run;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The court could not complete this case.');
      setPhase('IDLE');
      throw caught;
    }
  }

  async function runCourt(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (summary.trim().length < 10 || !asset.trim()) return;
    await executeCourt({ asset, market, timeframe, riskLevel, summary });
  }

  function downloadReport() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.report, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${result.report.reportId}.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="cerebra-shell">
      <aside className={`case-sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <div className="sidebar-brand"><BrandMark /><span>CEREBRA</span><button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close cases"><X /></button></div>
        <Button className="new-case-button" onClick={() => { setPhase('IDLE'); setSidebarOpen(false); }}><Plus /> New case</Button>
        <div className="sidebar-search"><Search /><input aria-label="Search cases" placeholder="Search case history" /></div>
        <nav className="case-list" aria-label="Case history">
          <p className="eyebrow">Recent proceedings</p>
          {cases.length > 0 ? cases.map((item) => (
            <button className="case-row" key={item.id}>
              <span className="asset-token">{item.submission.proposal.asset.slice(0, 2)}</span>
              <span className="case-row__copy"><strong>{item.submission.proposal.asset}</strong><small>{item.submission.proposal.timeframe} · {shortDate(item.createdAt)}</small></span>
              <span className={`status-dot tone-${statusTone(item.status)}`} />
            </button>
          )) : sampleCases.map((item) => (
            <button className={`case-row ${item.id === 'sample-btc' ? 'is-selected' : ''}`} key={item.id} onClick={() => { setResult(sampleReport); setSidebarOpen(false); }}>
              <span className="asset-token">{item.asset.slice(0, 2)}</span>
              <span className="case-row__copy"><strong>{item.asset}</strong><small>{item.votes} · {item.time} ago</small></span>
              <span className={`status-dot tone-${statusTone(item.status)}`} />
            </button>
          ))}
        </nav>
        <div className="sidebar-foot"><div><Database /><span><strong>{connected ? 'API connected' : 'Preview mode'}</strong><small>{connected ? 'Persistent case history' : 'Start backend for live runs'}</small></span></div><div className="connection-light" /></div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <main className="workspace">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open cases"><Menu /></button>
          <div className="topbar-title"><span className="breadcrumb">Courtroom <ChevronRight /> Active case</span><h1>Decision chamber</h1></div>
          <div className="topbar-actions"><span className={`live-status ${connected ? 'is-live' : ''}`}><span /> {connected ? 'System live' : 'Preview data'}</span><Button variant="outline" size="sm" onClick={() => void loadCases()}><RefreshCw /> Sync</Button></div>
        </header>

        <div className="workspace-scroll">
          <section className="case-composer-section">
            <div className="section-heading"><div><p className="eyebrow">New proceeding</p><h2>Put a thesis before the court.</h2></div><p>Bitget gathers live evidence. Claude builds, challenges, and independently judges the case.</p></div>
            <form className="case-composer" onSubmit={runCourt}>
              <label className="field" htmlFor="case-asset"><span>Asset</span><Input id="case-asset" value={asset} onChange={(event) => setAsset(event.target.value)} placeholder="BTCUSDT" required /></label>
              <label className="field" htmlFor="case-market"><span>Market</span><NativeSelect id="case-market" className="w-full" value={market} onChange={(event) => setMarket(event.target.value)}><NativeSelectOption value="spot">Spot</NativeSelectOption><NativeSelectOption value="usdt-futures">USDT futures</NativeSelectOption></NativeSelect></label>
              <label className="field" htmlFor="case-timeframe"><span>Horizon</span><NativeSelect id="case-timeframe" className="w-full" value={timeframe} onChange={(event) => setTimeframe(event.target.value)}><NativeSelectOption value="15m">15 minutes</NativeSelectOption><NativeSelectOption value="1h">1 hour</NativeSelectOption><NativeSelectOption value="4h">4 hours</NativeSelectOption><NativeSelectOption value="1d">1 day</NativeSelectOption></NativeSelect></label>
              <label className="field" htmlFor="case-risk"><span>Risk posture</span><NativeSelect id="case-risk" className="w-full" value={riskLevel} onChange={(event) => setRiskLevel(event.target.value as typeof riskLevel)}><NativeSelectOption value="LOW">Low</NativeSelectOption><NativeSelectOption value="MEDIUM">Medium</NativeSelectOption><NativeSelectOption value="HIGH">High</NativeSelectOption></NativeSelect></label>
              <label className="field field-thesis" htmlFor="case-summary"><span>Decision thesis</span><Textarea id="case-summary" value={summary} onChange={(event) => setSummary(event.target.value)} minLength={10} maxLength={4000} required /></label>
              <div className="composer-submit"><div className="evidence-source"><Radio /><span><strong>Live market evidence</strong><small>Bitget public market API · no trading access</small></span></div><Button type="submit" size="lg" disabled={isRunning}>{isRunning ? <LoaderCircle className="animate-spin" /> : <Gavel />}{phase === 'COLLECTING' ? 'Gathering evidence' : phase === 'ANALYSING' ? 'Court deliberating' : 'Convene court'}{!isRunning && <ArrowRight />}</Button></div>
            </form>
            {error && <div className="error-banner" role="alert"><CircleAlert /><span><strong>The court did not complete this run.</strong>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error"><X /></button></div>}
          </section>

          <section className="ruling-section">
            <div className="ruling-toolbar"><div><p className="eyebrow">Latest ruling</p><div className="ruling-title-row"><h2>{result.report.proposal.id}</h2><Badge variant="outline">{result.provider} · {result.model}</Badge></div></div><Button variant="outline" size="sm" onClick={downloadReport}><Download /> Export record</Button></div>
            <Pipeline phase={phase === 'IDLE' ? 'COMPLETE' : phase} />
            <div className="verdict-grid">
              <div className={`verdict-card verdict-${verdict.toLowerCase().replace(' ', '-')}`}><div className="verdict-seal"><Scale /></div><div><p>Ruling of the court</p><h3>{verdict}</h3><span>{result.report.status} · {result.report.tally.approve} approve / {result.report.tally.reject} reject</span></div></div>
              <div className="decision-note"><span className="quote-mark">“</span><p>{result.report.proposal.summary}</p><div><Activity /> Decision completed in {Math.max(1, Math.round((new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime()) / 1000))} seconds</div></div>
            </div>
            <div className="judges-heading"><div><p className="eyebrow">Panel opinions</p><h2>Three lenses. One accountable ruling.</h2></div><span>{result.report.judges.length}/3 judges reported</span></div>
            <div className="judges-grid">{result.report.judges.map((opinion) => <JudgeCard opinion={opinion} key={opinion.judgeId} />)}</div>
            <Dissent opinions={result.report.judges} />
            <div className="evidence-strip"><div className="evidence-strip__icon"><Fingerprint /></div><div><p className="eyebrow">Evidence integrity</p><strong>{result.report.evidence.length} signed market source{result.report.evidence.length === 1 ? '' : 's'}</strong><span>{result.report.evidence[0]?.source ?? 'No evidence source'} · observed {result.report.evidence[0] ? shortDate(result.report.evidence[0].observedAt) : '—'}</span></div><code>{result.report.evidence[0]?.digest.slice(0, 20) ?? 'no digest'}…</code></div>
          </section>
        </div>
      </main>
    </div>
  );
}
