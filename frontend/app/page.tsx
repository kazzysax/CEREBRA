'use client';
/* oxlint-disable react/react-compiler */

import { SyntheticEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowDownRight, ArrowRight, BookOpen, Cable, Check, CircleAlert, Clipboard, Code2, Database, Download, Fingerprint, Gavel, History, LoaderCircle, PanelsTopLeft, Plus, Radio, RefreshCw, Scale, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { BrandMark, CourtProgress, type CourtSubStage, Dissent, JudgeCard } from '@/components/court-panel';
import { cerebraApi, getSessionAgentKey, shortDate, type CaseRecord, type CourtJob, type CourtRunRecord, type CourtRunResult, type RunPhase } from '@/lib/cerebra';

const agentGuideSnippets = {
  http: 'POST ${CEREBRA_API_URL}/v1/cases\nAuthorization: Bearer <agent-api-key>\n{\n  "proposal": {\n    "asset": "TSLAUSDT",\n    "market": "usdt-futures",\n    "timeframe": "4h",\n    "summary": "Evaluate a provisional TSLA long thesis."\n  },\n  "riskLevel": "MEDIUM",\n  "evidenceMode": "BITGET"\n}\n\nPOST /v1/cases/{caseId}/jobs\nGET  /v1/jobs/{jobId}\nGET  /v1/runs/{runId}/report',
  mcp: '{\n  "mcpServers": {\n    "cerebra": {\n      "url": "${CEREBRA_API_URL}/mcp",\n      "headers": { "Authorization": "Bearer <agent-api-key>" }\n    }\n  }\n}\n\nWorkflow tools:\n- cerebra_create_case\n- cerebra_enqueue_court\n- cerebra_get_job\n- cerebra_get_report\n- cerebra_save_strategy\n- cerebra_recall_memory\n- cerebra_save_checkpoint',
  browser: 'Tool: create_cerebra_case_and_run_court\n\nInput:\n  asset (U.S. stock) · timeframe\n  riskLevel · summary\n\nReturns:\n  runId · verdict · status\n  dissentingJudgeIds',
} as const;

type CourtInput = {
  asset: string;
  timeframe: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: string;
};

// Cerebra is a U.S. stock desk: every symbol here is a tokenized U.S. equity on
// Bitget's usdt-futures market—there is no crypto-pair option.
const stockPairs = [
  { value: 'TSLAUSDT', label: 'Tesla (TSLA)' },
  { value: 'AAPLUSDT', label: 'Apple (AAPL)' },
  { value: 'NVDAUSDT', label: 'Nvidia (NVDA)' },
  { value: 'MSFTUSDT', label: 'Microsoft (MSFT)' },
  { value: 'AMZNUSDT', label: 'Amazon (AMZN)' },
  { value: 'GOOGLUSDT', label: 'Alphabet (GOOGL)' },
  { value: 'METAUSDT', label: 'Meta (META)' },
  { value: 'NFLXUSDT', label: 'Netflix (NFLX)' },
  { value: 'AMDUSDT', label: 'AMD (AMD)' },
  { value: 'COINUSDT', label: 'Coinbase (COIN)' },
  { value: 'JPMUSDT', label: 'JPMorgan Chase (JPM)' },
  { value: 'DISUSDT', label: 'Disney (DIS)' },
] as const;

const STOCK_MARKET = 'usdt-futures' as const;

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
  const market = STOCK_MARKET;
  const [asset, setAsset] = useState<string>(stockPairs[0].value);
  const [timeframe, setTimeframe] = useState('4h');
  const [riskLevel, setRiskLevel] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [summary, setSummary] = useState('');
  const [phase, setPhase] = useState<RunPhase>('IDLE');
  const [result, setResult] = useState<CourtRunResult | null>(null);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [copiedGuide, setCopiedGuide] = useState<keyof typeof agentGuideSnippets | null>(null);
  const [courtSubStage, setCourtSubStage] = useState<CourtSubStage>('EVIDENCE');
  const isRunning = phase === 'COLLECTING' || phase === 'ANALYSING';
  const verdict = result?.report.verdict ?? 'NO VERDICT';

  useEffect(() => {
    if (phase !== 'ANALYSING') { setCourtSubStage('EVIDENCE'); return; }
    setCourtSubStage('EVIDENCE');
    // These estimated beats keep the narrative moving for an anonymous run (a single
    // blocking call with no intermediate signal at all). A connected agent's job
    // polling overrides this with the backend's real stage as soon as it arrives—see
    // syncCourtSubStage below—so this is only ever a starting guess, never the source
    // of truth once real data is available.
    const toRecord = setTimeout(() => setCourtSubStage('RECORD'), 1500);
    const toChallenger = setTimeout(() => setCourtSubStage('CHALLENGER'), 4000);
    const toJudges = setTimeout(() => setCourtSubStage('JUDGES'), 8000);
    return () => { clearTimeout(toRecord); clearTimeout(toChallenger); clearTimeout(toJudges); };
  }, [phase]);

  const courtSubStageOrder: CourtSubStage[] = ['EVIDENCE', 'RECORD', 'CHALLENGER', 'JUDGES'];
  function syncCourtSubStage(next: CourtSubStage) {
    setCourtSubStage((current) =>
      courtSubStageOrder.indexOf(next) > courtSubStageOrder.indexOf(current) ? next : current);
  }

  async function copyAgentGuide(guide: keyof typeof agentGuideSnippets) {
    await navigator.clipboard.writeText(agentGuideSnippets[guide]);
    setCopiedGuide(guide);
  }

  async function loadCases() {
    if (!getSessionAgentKey()) {
      setCases([]);
      setConnected(false);
      return;
    }
    try {
      const response = await cerebraApi<{ cases: CaseRecord[] }>('/v1/cases?limit=12');
      setCases(response.cases);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => void loadCases());
    const context = (document as Document & { modelContext?: WebMcpContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: 'create_cerebra_case_and_run_court',
      title: 'Convene Cerebra court',
      description: 'Create a U.S. stock thesis, gather Bitget market evidence, run the multi-agent court, and return its verdict and dissent.',
      inputSchema: {
        type: 'object',
        properties: {
          asset: { type: 'string', description: 'Tokenized U.S. stock symbol such as TSLAUSDT.' },
          timeframe: { type: 'string', enum: ['15m', '1h', '4h', '1d'] },
          riskLevel: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          summary: { type: 'string', minLength: 10, description: 'The decision thesis to put before the court.' },
        },
        required: ['asset', 'timeframe', 'riskLevel', 'summary'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(value) {
        if (!value || typeof value !== 'object') throw new Error('A case input object is required.');
        const candidate = value as Record<string, unknown>;
        if (typeof candidate.asset !== 'string' || typeof candidate.summary !== 'string' || candidate.summary.trim().length < 10) {
          throw new Error('asset and a summary of at least 10 characters are required.');
        }
        if (!['15m', '1h', '4h', '1d'].includes(String(candidate.timeframe)) || !['LOW', 'MEDIUM', 'HIGH'].includes(String(candidate.riskLevel))) {
          throw new Error('timeframe or riskLevel is invalid.');
        }
        const run = await executeCourt(candidate as unknown as CourtInput);
        return { runId: run.runId, verdict: run.report.verdict, status: run.report.status, dissentingJudgeIds: run.report.dissentingJudgeIds };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  async function executeCourt(input: CourtInput) {
    setAsset(input.asset.toUpperCase());
    setTimeframe(input.timeframe);
    setRiskLevel(input.riskLevel);
    setSummary(input.summary);
    setError(null);
    setPhase('COLLECTING');
    try {
      const created = await cerebraApi<CaseRecord>('/v1/cases', {
        method: 'POST',
        body: JSON.stringify({
          proposal: { asset: input.asset.trim().toUpperCase(), market: STOCK_MARKET, timeframe: input.timeframe, summary: input.summary.trim() },
          riskLevel: input.riskLevel,
          evidenceMode: 'BITGET',
        }),
      });
      setCases((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setPhase('ANALYSING');
      let run: CourtRunResult;
      if (getSessionAgentKey()) {
        // Connected agents get the durable, resumable job path (identity-scoped idempotency key).
        const job = await cerebraApi<CourtJob>(`/v1/cases/${created.id}/jobs`, {
          method: 'POST',
          headers: { 'idempotency-key': crypto.randomUUID() },
          body: JSON.stringify({ refreshEvidence: false }),
        });
        let current = job;
        for (let attempt = 0; attempt < 180 && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(current.status); attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          current = await cerebraApi<CourtJob>(`/v1/jobs/${job.id}`);
          // The job's real backend stage—not a guess—so it only ever moves the
          // narrative forward, correcting the timer if reality runs ahead of it.
          if (current.stage === 'EVIDENCE') syncCourtSubStage('EVIDENCE');
          else if (current.stage === 'RECORD') syncCourtSubStage('RECORD');
          else if (current.stage === 'ANALYST') syncCourtSubStage('CHALLENGER');
          else if (current.stage === 'PERSISTING') syncCourtSubStage('JUDGES');
        }
        if (current.status !== 'COMPLETED' || !current.runId) {
          throw new Error(current.error ?? `Court job ended with ${current.status}.`);
        }
        const runRecord = await cerebraApi<CourtRunRecord>(`/v1/runs/${current.runId}`);
        if (!runRecord.result) throw new Error('The completed court job did not contain a result.');
        run = runRecord.result;
      } else {
        // Anonymous visitors have no agent identity to own a durable job against, so run the
        // court synchronously—case creation already supports an unowned, unpersisted case.
        run = await cerebraApi<CourtRunResult>(`/v1/cases/${created.id}/run`, {
          method: 'POST',
          body: JSON.stringify({ refreshEvidence: false }),
        });
      }
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
    try {
      await executeCourt({ asset, timeframe, riskLevel, summary });
    } catch {
      // executeCourt already records the failure via setError; nothing further to do here.
    }
  }

  function downloadReport() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.report, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${result.report.reportId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="cerebra-shell">
        <header className="command-nav">
          <a className="command-brand" href="#top" aria-label="Cerebra home"><BrandMark /><span>CEREBRA</span></a>
          <div className="command-nav__meta" aria-label="System status"><span>PERSISTENT INTELLIGENCE / LOOP LEARNING</span><span className={connected ? 'is-connected' : ''}>{connected ? 'MARKET FEED LIVE' : 'CONNECT AN AGENT'}</span></div>
          <div className="command-nav__actions">
            <a className="command-control" aria-label="Open agent case history" title="Open agent case history" href="/agents"><Search /></a>
            <a className="command-control" aria-label="Open API and MCP documentation" title="Open API and MCP documentation" href="/docs/agents"><BookOpen /></a>
            <a className="command-control" aria-label="Open agent login" title="Open agent login" href="/agents"><Fingerprint /></a>
            <a className="command-control command-control--history" aria-label="Open agent case history" title="Open agent case history" href="/agents"><History /></a>
            <button className="command-primary" onClick={() => document.getElementById('case-input')?.scrollIntoView({ behavior: 'smooth' })}>Review stock <ArrowDownRight /></button>
          </div>
        </header>

        <section className="hero-stage" id="top">
          <div className="hero-copy">
            <div className="technical-kicker"><span>AI TRADING DESK / COURT 01</span><i /></div>
            <h1>Persistent intelligence.<br />Dissent, then<br /><span>loop learning.</span></h1>
            <p>Cerebra turns market facts into scrutinized direction from a full three-judge court, then closes the loop: persistent memory carries every ruling and dissent forward, and each judge's confidence self-calibrates against what actually happened next.</p>
            <div className="hero-actions">
              <button className="text-action" onClick={() => document.getElementById('case-input')?.scrollIntoView({ behavior: 'smooth' })}>Put intelligence under scrutiny <ArrowRight /></button>
              <span><i /> U.S. STOCKS · TOKENIZED MARKETS · HUMAN FINAL CALL</span>
            </div>
          </div>
          <div className="court-core court-core--brain" aria-label="Cerebra intelligence, rendered as a rotating brain">
            <video className="brain-video" autoPlay loop muted playsInline aria-hidden="true">
              <source src="/cerebra-brain.webm" type="video/webm" />
              <source src="/cerebra-brain.mp4" type="video/mp4" />
            </video>
          </div>
        </section>
      </div>

      <section className="landing-manifesto" aria-labelledby="what-cerebra-builds">
        <div className="landing-manifesto__inner">
          <div className="chapter-label chapter-label--light"><span>01</span><i /><strong>WHAT WE BUILD</strong></div>
          <div className="manifesto-grid">
            <div>
              <p className="manifesto-overline">LEARNING INTELLIGENCE / NOT ANOTHER SIGNAL BOT</p>
              <h2 id="what-cerebra-builds">Intelligence with<br />direction, memory<br /><span>and loop learning.</span></h2>
            </div>
            <div className="manifesto-copy">
              <p>Intelligence without a feedback loop is distraction. Cerebra gathers market facts, tests the thesis before a full three-judge court, then loop-learns from what happens next: persistent memory carries the ruling forward, and every post-trade outcome self-calibrates judge confidence for the next review.</p>
              <button onClick={() => document.getElementById('architecture')?.scrollIntoView({ behavior: 'smooth' })}>Explore the architecture <ArrowDownRight /></button>
            </div>
          </div>
          <div className="manifesto-metrics">
            <div><small>INDEPENDENT JUDGES</small><strong>03</strong><span>Risk · Evidence · Strategy</span></div>
            <div><small>ADVERSARIAL ROLES</small><strong>02</strong><span>Analyst builds · Challenger cross-examines</span></div>
            <div><small>FINAL AUTHORITY</small><strong>YOU</strong><span>AI analyzes; the trader makes the call</span></div>
          </div>
        </div>
      </section>

      <section className="problem-section" aria-labelledby="problem-title">
        <div className="problem-section__inner">
          <div className="chapter-label"><span>02</span><i /><strong>THE BROKEN DEFAULT</strong></div>
          <div className="problem-heading">
            <p>THE CLICHÉ MODEL</p>
            <h2 id="problem-title">Intelligence without<br />direction is<br /><span>distraction.</span></h2>
            <div><p>Most market agents depend on one model to reason and return one answer. The evidence disappears, disagreement is erased, and no durable record tells the next agent what was tested or why it matters.</p><small>CONFIDENCE IS NOT CONSENSUS.</small></div>
          </div>

          <div className="model-comparison">
            <div className="model-plane model-plane--legacy">
              <div className="plane-label"><span>MODEL / DEFAULT</span><strong>OPAQUE</strong></div>
              <div className="legacy-flow">
                <span>STOCK THESIS</span><i>→</i><span>SINGLE LLM</span><i>→</i><span>BUY / SELL</span>
              </div>
              <ul>
                <li><span>01</span>No challenge to the original assumption</li>
                <li><span>02</span>Sources and contradictions disappear</li>
                <li><span>03</span>Context resets on the next conversation</li>
                <li><span>04</span>A confident answer can hide weak evidence</li>
              </ul>
            </div>
            <div className="comparison-transfer" aria-hidden="true"><span>STRESS TEST</span><i /><b>+</b></div>
            <div className="model-plane model-plane--cerebra">
              <div className="plane-label"><span>CEREBRA / COURT</span><strong>AUDITABLE</strong></div>
              <div className="court-flow">
                <span>BITGET<br />INTELLIGENCE</span><i />
                <span>ANALYST<br />vs CHALLENGER</span><i />
                <span>3 JUDGES<br />+ DISSENT</span>
              </div>
              <ul>
                <li><span>01</span>Evidence is sealed before deliberation</li>
                <li><span>02</span>The challenger searches for failure modes</li>
                <li><span>03</span>Judges vote through separate decision lenses</li>
                <li><span>04</span>Outcome monitoring closes the loop, self-calibrating the next review</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-architecture" id="architecture" aria-labelledby="architecture-title">
        <div className="architecture-environment" aria-hidden="true"><span /><span /><span /></div>
        <div className="landing-architecture__inner">
          <div className="chapter-label"><span>03</span><i /><strong>COURT ARCHITECTURE</strong></div>
          <div className="architecture-heading">
            <h2 id="architecture-title">From intelligence<br />to an informed<br />move.</h2>
            <div><span>{'// CEREBRA COURT 001'}</span><p>The Cerebra Court gathers evidence, interrogates the thesis, weighs it through three independent judge lenses, and returns the full procedure - not a black-box answer.</p></div>
          </div>
          <div className="architecture-rail">
            <article><span>01 / INGEST</span><h3>Stock intelligence enters.</h3><p>Quotes, order-book depth and candles are collected through read-only Bitget infrastructure and sealed with source metadata.</p><small>BITGET · READ ONLY</small></article>
            <article><span>02 / CHALLENGE</span><h3>The thesis is attacked.</h3><p>Qwen powers an analyst and challenger that test catalysts, liquidity, timing, assumptions and failure modes.</p><small>QWEN · ADVERSARIAL</small></article>
            <article><span>03 / JUDGE</span><h3>No one agent decides.</h3><p>Risk, evidence, and strategy judges vote independently. Cerebra issues a ruling only after the panel's majority vote; dissent remains in the record.</p><small>3 JUDGES · 1 VOTE</small></article>
            <article><span>04 / LOOP LEARN</span><h3>The next decision learns.</h3><p>Persistent memory stores evidence, ballots and dissent; post-ruling outcomes self-calibrate each judge's confidence, closing the loop before the next review.</p><small>SELF-CALIBRATED</small></article>
          </div>
          <div className="architecture-cta">
            <div><span>COURT READY / 03 JUDGES / HUMAN-GATED</span><i /></div>
            <button onClick={() => document.getElementById('case-input')?.scrollIntoView({ behavior: 'smooth' })}>Enter the court <ArrowRight /></button>
          </div>
        </div>
      </section>

      <section className="advantage-section" aria-labelledby="advantage-title">
        <div className="advantage-section__inner">
          <div className="chapter-label chapter-label--light"><span>04</span><i /><strong>WHY CEREBRA</strong></div>
          <div className="advantage-heading">
            <h2 id="advantage-title">Not a signal.<br />A decision layer.</h2>
            <p>Cerebra gives agents more than a one-off answer: a full three-judge court, persistent memory across sessions, and self-loop learning that turns every outcome into a sharper next ruling.</p>
          </div>

          <div className="feature-lattice">
            <article><span>01</span><div><small>MEMORY / DURABLE</small><h3>Persistent memory<br />across every session</h3><p>Cases, strategy versions, sealed evidence and ballots remain available to give the next review real context after the chat or agent restarts—nothing resets.</p></div><code>RECALL_READY</code></article>
            <article><span>02</span><div><small>ADVISORY / EVIDENCE-BOUND</small><h3>A better route when needed</h3><p>If the court rejects the original thesis, it can propose a supported alternative direction, timing, conditions and invalidation—never a guaranteed return or an automatic order.</p></div><code>ALTERNATIVE_ROUTE</code></article>
            <article><span>03</span><div><small>LOOP / SELF-CORRECTING</small><h3>Every judge is graded<br />on what really happened</h3><p>Report the real outcome and each judge's accuracy on resolved rulings is tracked independently—a judge with a bad track record on risk gets quieter over time, without touching the other two lenses.</p></div><code>SELF_CORRECTING</code></article>
            <article><span>04</span><div><small>COURT / 3 ISOLATED BALLOTS</small><h3>Three independent judges</h3><p>No single agent gives the decision. Risk, evidence and strategy judges vote independently; the majority gives direction while the dissent preserves what it challenged.</p></div><code>2_OF_3</code></article>
            <article><span>05</span><div><small>LEARNING / SELF-CALIBRATED</small><h3>The record teaches<br />the next ruling</h3><p>Report what actually happened after execution and each judge's confidence self-calibrates against its own track record—a real loop-learning system, not a static scorecard.</p></div><code>LOOP_LEARNED</code></article>
            <article><span>06</span><div><small>SAFETY / HUMAN CONTROL</small><h3>Human final-decision gate</h3><p>Cerebra analyzes and stress-tests. It does not present an advisory ruling as guaranteed profit or silently place the trade.</p></div><code>NO_AUTO_ORDER</code></article>
          </div>

          <div className="hackathon-fit">
            <div className="hackathon-fit__lead">
              <span>BITGET AI · GENESIS SEASON 2</span>
              <h3>Built for the<br />AI Trading Desk.</h3>
              <p>Decision stress-testing for tokenized U.S. stocks, grounded in Bitget market evidence.</p>
            </div>
            <div className="hackathon-fit__spec">
              <div><span>TRACK</span><strong>AI Trading Desk</strong></div>
              <div><span>SUBTHEME</span><strong>Decision stress-testing</strong></div>
              <div><span>BITGET ROLE</span><strong>Read-only market intelligence</strong></div>
              <div><span>LLM ROLE</span><strong>Analyst, challenger and judges</strong></div>
              <div><span>FINAL AUTHORITY</span><strong>Human trader</strong></div>
              <div><span>EXECUTION</span><strong>Outside the court boundary</strong></div>
            </div>
            <div className="hackathon-fit__links">
              <a href="https://www.bitget.com/activity-hub/hackathon" target="_blank" rel="noreferrer">Season 2 brief <ArrowRight /></a>
              <a href="https://www.bitget.com/activity-hub/agent-hub" target="_blank" rel="noreferrer">Bitget Agent Hub <ArrowRight /></a>
            </div>
          </div>
        </div>
      </section>

      <section className="agent-connect-section" id="agent-connect" aria-labelledby="agent-connect-title">
        <div className="agent-connect-section__inner">
          <div className="chapter-label"><span>CONNECT / 01</span><i /><strong>AGENT ACCESS</strong></div>
          <div className="agent-connect-heading">
            <h2 id="agent-connect-title">One record.<br />Every informed move.</h2>
            <div>
              <p>Give your trading agent a Cerebra API origin. It can convene the full court, retrieve persistent history and dissent, record outcomes, and let loop learning carry a self-calibrated Decision Kit into the next review.</p>
              <small>ADVISORY OUTPUT ONLY · HUMAN EXECUTION GATE</small>
            </div>
          </div>

          <Tabs defaultValue="http" className="agent-guide">
            <TabsList variant="line" className="agent-guide__tabs" aria-label="Agent connection methods">
              <TabsTrigger value="http"><Code2 />HTTP API <span>RECOMMENDED</span></TabsTrigger>
              <TabsTrigger value="mcp"><Cable />MCP <span>FULL TOOLSET</span></TabsTrigger>
              <TabsTrigger value="browser"><PanelsTopLeft />BROWSER TOOL <span>BUILT IN</span></TabsTrigger>
            </TabsList>

            <TabsContent value="http">
              <article className="agent-guide-panel">
                <div className="agent-guide-panel__lead">
                  <span>01 / DECISION KIT API</span>
                  <h3>The complete intelligence record.</h3>
                  <p>Use HTTP when an agent needs to create a case, refresh evidence, run all five reasoning roles, and retrieve the ruling later from persistent memory.</p>
                  <strong><i /> BACKEND ROUTE READY</strong>
                </div>
                <ol className="connection-steps">
                  <li><span>01</span><div><strong>Create the case</strong><p>Send the symbol, market, horizon, risk posture and thesis.</p></div></li>
                  <li><span>02</span><div><strong>Run the court</strong><p>Cerebra collects Bitget evidence and starts Analyst, Challenger and Judge agents.</p></div></li>
                  <li><span>03</span><div><strong>Read the Decision Kit</strong><p>Retrieve facts, arguments, three ballots, direction, dissent and the complete procedure.</p></div></li>
                </ol>
                <div className="connection-terminal">
                  <div className="connection-terminal__bar"><span><i /><i /><i />AGENT_REQUEST.HTTP</span><button onClick={() => void copyAgentGuide('http')}>{copiedGuide === 'http' ? <Check /> : <Clipboard />}{copiedGuide === 'http' ? 'Copied' : 'Copy'}</button></div>
                  <pre><code>{agentGuideSnippets.http}</code></pre>
                </div>
              </article>
            </TabsContent>

            <TabsContent value="mcp">
              <article className="agent-guide-panel">
                <div className="agent-guide-panel__lead">
                  <span>02 / MODEL CONTEXT PROTOCOL</span>
                  <h3>Discover Cerebra as a tool server.</h3>
                  <p>Point an MCP-compatible client at the Cerebra endpoint. The full surface creates cases, queues durable court jobs, retrieves Decision Kits, and reads or writes persistent agent memory.</p>
                  <strong><i /> WORKFLOW TOOLS ACTIVE</strong>
                </div>
                <ol className="connection-steps">
                  <li><span>01</span><div><strong>Add the endpoint</strong><p>Register the deployed Cerebra origin followed by <code>/mcp</code>.</p></div></li>
                  <li><span>02</span><div><strong>Discover available tools</strong><p>The client reads tool names, schemas and structured-result contracts.</p></div></li>
                  <li><span>03</span><div><strong>Run the complete workflow</strong><p>Create the case, enqueue the court, poll its durable job, then retrieve the report.</p></div></li>
                </ol>
                <div className="connection-terminal">
                  <div className="connection-terminal__bar"><span><i /><i /><i />MCP_CONNECTION.JSON</span><button onClick={() => void copyAgentGuide('mcp')}>{copiedGuide === 'mcp' ? <Check /> : <Clipboard />}{copiedGuide === 'mcp' ? 'Copied' : 'Copy'}</button></div>
                  <pre><code>{agentGuideSnippets.mcp}</code></pre>
                </div>
              </article>
            </TabsContent>

            <TabsContent value="browser">
              <article className="agent-guide-panel">
                <div className="agent-guide-panel__lead">
                  <span>03 / WEBMCP INTERFACE</span>
                  <h3>Operate the court through the page.</h3>
                  <p>On a WebMCP-capable browser, Cerebra registers one task-completing tool that creates the case, runs the court, and returns the verdict plus dissent identifiers.</p>
                  <strong><i /> TOOL REGISTERED</strong>
                </div>
                <ol className="connection-steps">
                  <li><span>01</span><div><strong>Open Cerebra</strong><p>The page publishes its structured court tool to the browser agent.</p></div></li>
                  <li><span>02</span><div><strong>Describe the thesis</strong><p>The browser agent supplies validated stock-case fields to the tool.</p></div></li>
                  <li><span>03</span><div><strong>Continue with the run ID</strong><p>The agent can hand the result to a human or retrieve the persistent report.</p></div></li>
                </ol>
                <div className="connection-terminal">
                  <div className="connection-terminal__bar"><span><i /><i /><i />WEBMCP_TOOL.TXT</span><button onClick={() => void copyAgentGuide('browser')}>{copiedGuide === 'browser' ? <Check /> : <Clipboard />}{copiedGuide === 'browser' ? 'Copied' : 'Copy'}</button></div>
                  <pre><code>{agentGuideSnippets.browser}</code></pre>
                </div>
              </article>
            </TabsContent>
          </Tabs>

          <div className="connection-boundary"><span>PRODUCTION NOTE</span><p>Public agents need a deployed Cerebra backend URL and API authentication. Cerebra returns analysis—not an exchange order.</p><Link href="/docs/agents">Full documentation <ArrowRight /></Link></div>
        </div>
      </section>

      <aside className={`history-drawer ${sidebarOpen ? 'is-open' : ''}`} aria-hidden={!sidebarOpen}>
        <div className="drawer-head"><div><BrandMark /><span>CASE ARCHIVE</span></div><button onClick={() => setSidebarOpen(false)} aria-label="Close case archive"><X /></button></div>
        <button className="drawer-new" onClick={() => { setPhase('IDLE'); setSidebarOpen(false); document.getElementById('case-input')?.scrollIntoView({ behavior: 'smooth' }); }}><Plus /> New proceeding</button>
        <div className="drawer-search"><Search /><input aria-label="Search cases" placeholder="Search case archive" /></div>
        <nav className="case-list" aria-label="Case history">
          <p className="eyebrow">Recent proceedings</p>
          {cases.length > 0 ? cases.map((item) => (
            <button className="case-row" key={item.id}>
              <span className="asset-token">{item.submission.proposal.asset.slice(0, 2)}</span>
              <span className="case-row__copy"><strong>{item.submission.proposal.asset}</strong><small>{item.submission.proposal.timeframe} · {shortDate(item.createdAt)}</small></span>
              <span className={`status-dot tone-${statusTone(item.status)}`} />
            </button>
          )) : <p className="drawer-empty">No court proceedings yet. Submit a thesis to create the first record.</p>}
        </nav>
        <div className="drawer-foot"><Database /><span><strong>{connected ? 'API connected' : 'Agent connection required'}</strong><small>{connected ? 'Persistent case memory online' : 'Register or connect an agent to access case memory'}</small></span><i className={connected ? 'is-live' : ''} /></div>
      </aside>
      {sidebarOpen ? <button className="drawer-scrim" aria-label="Close case archive" onClick={() => setSidebarOpen(false)} /> : null}

      <main className="cerebra-system" id="case-input">
        <section className="system-section input-section">
          <div className="chapter-label"><span>01</span><i /><strong>SYSTEM INPUT</strong></div>
          <div className="section-statement">
            <h2>Put a stock thesis<br />under pressure.</h2>
            <div><p>Define the trade idea—not the order. Cerebra gathers live Bitget market evidence, cross-examines the thesis, and records how three independent judges disagree.</p><button onClick={() => setSidebarOpen(true)}>Browse stock reviews <ArrowRight /></button></div>
          </div>
          <form className="case-machine" onSubmit={runCourt}>
            <div className="machine-index"><span>LIVE CASE TERMINAL</span><strong>NEW CASE</strong></div>
            <div className="machine-fields">
              <label className="field" htmlFor="case-asset"><span>01 / U.S. stock</span><NativeSelect id="case-asset" className="w-full" value={asset} onChange={(event) => setAsset(event.target.value)}>{stockPairs.map((item) => <NativeSelectOption key={item.value} value={item.value}>{item.label}</NativeSelectOption>)}</NativeSelect></label>
              <label className="field" htmlFor="case-timeframe"><span>02 / Horizon</span><NativeSelect id="case-timeframe" className="w-full" value={timeframe} onChange={(event) => setTimeframe(event.target.value)}><NativeSelectOption value="15m">15 minutes</NativeSelectOption><NativeSelectOption value="1h">1 hour</NativeSelectOption><NativeSelectOption value="4h">4 hours</NativeSelectOption><NativeSelectOption value="1d">1 day</NativeSelectOption></NativeSelect></label>
              <label className="field" htmlFor="case-risk"><span>03 / Risk posture</span><NativeSelect id="case-risk" className="w-full" value={riskLevel} onChange={(event) => setRiskLevel(event.target.value as typeof riskLevel)}><NativeSelectOption value="LOW">Low</NativeSelectOption><NativeSelectOption value="MEDIUM">Medium</NativeSelectOption><NativeSelectOption value="HIGH">High</NativeSelectOption></NativeSelect></label>
              <label className="field field-thesis" htmlFor="case-summary"><span>04 / Thesis to test</span><Textarea id="case-summary" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="State the thesis, catalyst, and what you want the court to challenge." minLength={10} maxLength={4000} required /></label>
            </div>
            <div className="machine-submit">
              <div className="evidence-source"><Radio /><span><strong>Live court ready</strong><small>Bitget evidence · five-agent court · no order execution</small></span></div>
              <Button type="submit" size="lg" disabled={isRunning}>{isRunning ? <LoaderCircle className="animate-spin" /> : <Gavel />}{phase === 'COLLECTING' ? 'Gathering live evidence' : phase === 'ANALYSING' ? 'Running the court' : 'Run court'}{!isRunning ? <ArrowRight /> : null}</Button>
            </div>
          </form>
          {error ? <div className="error-banner" role="alert"><CircleAlert /><span><strong>The court did not complete this run.</strong>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error"><X /></button></div> : null}
        </section>

        {result ? <>
        <section className="system-section intelligence-section">
          <div className="chapter-label"><span>02</span><i /><strong>INTELLIGENCE</strong></div>
          <div className="ruling-toolbar">
            <div><p className="eyebrow">Latest proceeding</p><div className="ruling-title-row"><h2>{result.report.proposal.id}</h2><Badge variant="outline">{result.provider} · {result.model}</Badge></div></div>
            <div className="ruling-actions"><span className={`live-status ${connected ? 'is-live' : ''}`}><i /> {connected ? 'System live' : 'Saved court record'}</span><Button variant="outline" size="sm" onClick={() => void loadCases()}><RefreshCw /> Sync</Button><Button variant="outline" size="sm" onClick={downloadReport}><Download /> Export</Button></div>
          </div>
          <div className="deliberation-module">
            <div className="module-grid" aria-hidden="true" />
            <CourtProgress phase={phase === 'IDLE' ? 'COMPLETE' : phase} subStage={courtSubStage} hasAgent={connected} result={result} />
            <div className="verdict-grid">
              <div className={`verdict-card verdict-${verdict.toLowerCase().replace(' ', '-')}`}><div className="verdict-seal"><Scale /></div><div><p>Ruling of the court</p><h3>{verdict}</h3><span>{result.report.status} · {result.report.tally.approve} approve / {result.report.tally.reject} reject</span></div></div>
              <div className="decision-note"><span className="quote-mark">“</span><p>{result.report.proposal.summary}</p><div><Activity /> Completed in {Math.max(1, Math.round((new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime()) / 1000))} seconds</div></div>
            </div>
          </div>
          <section className={`recommendation-card recommendation-${result.report.recommendation.status.toLowerCase()}`} aria-label="Advisory recommendation">
            <div className="recommendation-card__head"><span>COURT ADVISORY</span><strong>{result.report.recommendation.status.replace('_', ' ')}</strong></div>
            <div className="recommendation-card__direction"><span>CONSIDER</span><h3>{result.report.recommendation.direction}</h3><p>{result.report.recommendation.timing}</p></div>
            <div className="recommendation-card__body"><p>{result.report.recommendation.rationale}</p><div><strong>Before acting</strong><ul>{result.report.recommendation.conditions.map((condition) => <li key={condition}>{condition}</li>)}</ul></div><div><strong>Invalidation</strong><p>{result.report.recommendation.invalidation}</p></div></div>
            <small>{result.report.recommendation.disclaimer}</small>
          </section>
          <div className="proceeding-heading">
            <div><p className="eyebrow">Full proceeding record</p><h3>Intelligence. Argument. Cross-examination.</h3></div>
            <span>{result.trace.filter((entry) => entry.status === 'SUCCEEDED').length}/{result.trace.length} AGENT STAGES VERIFIED</span>
          </div>
          <div className="proceeding-record">
            <article className="record-plane intelligence-docket">
              <div className="record-plane__head"><span>01 / GATHERED INTELLIGENCE</span><strong>{result.report.evidence.length} SOURCE{result.report.evidence.length === 1 ? '' : 'S'}</strong></div>
              <div className="evidence-list">
                {result.report.evidence.map((item) => (
                  <div key={item.id}>
                    <span>{item.source}</span>
                    <h4>{item.title}</h4>
                    <p>{item.summary ?? 'Evidence retained without an additional summary.'}</p>
                    <code>{item.id} · {shortDate(item.observedAt)}</code>
                  </div>
                ))}
              </div>
            </article>
            <article className="record-plane analyst-brief">
              <div className="record-plane__head"><span>02 / ANALYST ARGUMENT</span><strong>{Math.round(result.analystCase.confidence * 100)}% CONF.</strong></div>
              <div className="argument-verdict"><span>{result.analystCase.recommendation}</span><p>{result.analystCase.thesis}</p></div>
              <ol>{result.analystCase.keyClaims.map((claim, index) => <li key={claim.claim}><span>0{index + 1}</span><p>{claim.claim}</p><code>{claim.evidenceIds.join(' · ')}</code></li>)}</ol>
              <div className="risk-register"><span>DISCLOSED RISKS</span>{result.analystCase.risks.map((risk) => <p key={risk}>{risk}</p>)}</div>
            </article>
            <article className="record-plane challenger-brief">
              <div className="record-plane__head"><span>03 / CHALLENGER BRIEF</span><strong>{Math.round(result.challenge.confidence * 100)}% CONF.</strong></div>
              <p className="challenge-conclusion">{result.challenge.conclusion}</p>
              <ol>{result.challenge.objections.map((objection, index) => <li key={objection.objection}><span>0{index + 1}</span><div><b>{objection.severity}</b><p>{objection.objection}</p><code>{objection.evidenceIds.join(' · ') || 'NO DIRECT CITATION'}</code></div></li>)}</ol>
              <div className="missing-evidence"><span>MISSING EVIDENCE</span>{result.challenge.missingEvidence.length > 0 ? result.challenge.missingEvidence.map((item) => <p key={item}>{item}</p>) : <p>None declared.</p>}</div>
            </article>
          </div>
        </section>

        <section className="system-section execution-section">
          <div className="chapter-label"><span>03</span><i /><strong>JUDGMENT</strong></div>
          <div className="section-statement section-statement--judges"><h2>Three lenses.<br />One accountable vote.</h2><p>No single agent decides. Risk, evidence, and strategy judges deliberate and vote independently; the majority creates the ruling while the minority reasoning stays visible.</p></div>
          <div className="judges-status"><span>PANEL / {result.report.judges.length} OF 3 REPORTED</span><i /><span>{result.report.dissentingJudgeIds.length} DISSENT FILED</span></div>
          <div className="judges-grid">{result.report.judges.map((opinion) => <JudgeCard opinion={opinion} key={opinion.judgeId} />)}</div>
          <Dissent opinions={result.report.judges} />
        </section>

        <section className="system-section network-section">
          <div className="chapter-label"><span>04</span><i /><strong>PROVENANCE</strong></div>
          <div className="evidence-object">
            <div className="evidence-object__lead"><Fingerprint /><div><small>EVIDENCE INTEGRITY</small><h2>Trace the ruling<br />back to source.</h2></div></div>
            <div className="evidence-object__data">
              <span>SOURCES</span><strong>{String(result.report.evidence.length).padStart(2, '0')}</strong>
              <span>ORIGIN</span><strong>{result.report.evidence[0]?.source ?? 'NO SOURCE'}</strong>
              <span>OBSERVED</span><strong>{result.report.evidence[0] ? shortDate(result.report.evidence[0].observedAt) : '—'}</strong>
              <span>DIGEST</span><code>{result.report.evidence[0]?.digest ?? 'no digest'}</code>
            </div>
          </div>
        </section>
        </> : isRunning ? <section className="system-section intelligence-section" aria-live="polite">
          <div className="chapter-label"><span>02</span><i /><strong>INTELLIGENCE</strong></div>
          <div className="section-statement">
            <h2>The court is<br />in session.</h2>
            <div><p>Live Bitget evidence, adversarial review, and three independent judges—your first ruling is being built now.</p></div>
          </div>
          <div className="deliberation-module">
            <div className="module-grid" aria-hidden="true" />
            <CourtProgress phase={phase} subStage={courtSubStage} hasAgent={connected} result={null} />
          </div>
        </section> : <section className="system-section empty-results-section" aria-live="polite">
          <div className="chapter-label"><span>02</span><i /><strong>COURT RECORD</strong></div>
          <div className="section-statement">
            <h2>Your first ruling<br />will appear here.</h2>
            <div><p>Connect an agent and convene the court to create a real, persistent Decision Kit. Your ruling will include the evidence, votes, dissent and advisory route from that proceeding.</p><button onClick={() => document.getElementById('case-input')?.scrollIntoView({ behavior: 'smooth' })}>Create a case <ArrowRight /></button></div>
          </div>
        </section>}

        <section className="system-section transaction-section" aria-labelledby="transaction-title">
          <div className="chapter-label"><span>05</span><i /><strong>AGENT TRANSACTION</strong></div>
          <div className="section-statement transaction-heading">
            <h2 id="transaction-title">A request enters.<br />A decision returns.</h2>
            <p>The complete Cerebra transaction, from a trading agent’s first thesis to a portable Decision Kit—with every reasoning boundary visible.</p>
          </div>

          <div className="transaction-slate">
            <div className="transaction-slate__top">
              <span><i /> COURT PROCESS / SEVEN STAGES</span>
              <strong>HUMAN-GATED</strong>
            </div>
            <div className="transaction-flow">
              <article className="transaction-node is-entry"><span>01</span><small>REQUEST</small><strong>Agent thesis</strong><p>Symbol · horizon · risk</p></article>
              <i className="transaction-link"><b /></i>
              <article className="transaction-node"><span>02</span><small>INTELLIGENCE</small><strong>Bitget evidence</strong><p>Ticker · book · candles</p></article>
              <i className="transaction-link"><b /></i>
              <article className="transaction-node"><span>03</span><small>ARGUMENT</small><strong>Analyst brief</strong><p>Claims · citations · risks</p></article>
              <i className="transaction-link"><b /></i>
              <article className="transaction-node"><span>04</span><small>CHALLENGE</small><strong>Cross-exam</strong><p>Objections · missing facts</p></article>
              <i className="transaction-link"><b /></i>
              <article className="transaction-node is-panel"><span>05</span><small>JUDGMENT</small><strong>Three judges</strong><p>Risk · evidence · strategy</p></article>
              <i className="transaction-link"><b /></i>
              <article className="transaction-node"><span>06</span><small>MEMORY</small><strong>Sealed record</strong><p>Votes · dissent · trace</p></article>
              <i className="transaction-link"><b /></i>
              <article className="transaction-node is-output"><span>07</span><small>OUTPUT</small><strong>Decision Kit</strong><p>JSON · Markdown · run ID</p></article>
            </div>
            <div className="transaction-slate__bottom">
              <span>INPUT / NON-CUSTODIAL</span>
              <i />
              <strong>OUTPUT / HUMAN REVIEW REQUIRED</strong>
            </div>
          </div>
        </section>

        <footer className="system-footer"><div><BrandMark /><span>CEREBRA / DECISION INFRASTRUCTURE</span></div><p>Every decision. Every vote. Every dissent.</p><button onClick={() => document.getElementById('top')?.scrollIntoView({ behavior: 'smooth' })}>RETURN TO TOP ↑</button></footer>
      </main>
    </>
  );
}
