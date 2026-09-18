'use client';
/* oxlint-disable react/react-compiler */

import { SyntheticEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowDownRight, ArrowRight, BookOpen, Cable, Check, CircleAlert, Clipboard, Code2, Database, Download, Fingerprint, Gavel, History, LoaderCircle, PanelsTopLeft, Plus, Radio, RefreshCw, Scale, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { BrandMark, Dissent, JudgeCard, Pipeline } from '@/components/court-panel';
import { cerebraApi, sampleReport, shortDate, type CaseRecord, type CourtJob, type CourtRunRecord, type CourtRunResult, type RunPhase } from '@/lib/cerebra';

const sampleCases = [
  { id: 'sample-tsla', asset: 'TSLAUSDT', status: 'APPROVED', time: '12m', votes: '2–1' },
  { id: 'sample-nvda', asset: 'NVDAUSDT', status: 'REJECTED', time: '1h', votes: '1–2' },
  { id: 'sample-aapl', asset: 'AAPLUSDT', status: 'INCONCLUSIVE', time: '3h', votes: '1–1' },
];

const agentGuideSnippets = {
  http: 'POST ${CEREBRA_API_URL}/v1/cases\nAuthorization: Bearer <agent-api-key>\n{\n  "proposal": {\n    "asset": "TSLAUSDT",\n    "market": "usdt-futures",\n    "timeframe": "4h",\n    "summary": "Evaluate a provisional TSLA long thesis."\n  },\n  "riskLevel": "MEDIUM",\n  "evidenceMode": "BITGET"\n}\n\nPOST /v1/cases/{caseId}/jobs\nGET  /v1/jobs/{jobId}\nGET  /v1/runs/{runId}/report',
  mcp: '{\n  "mcpServers": {\n    "cerebra": {\n      "url": "${CEREBRA_API_URL}/mcp",\n      "headers": { "Authorization": "Bearer <agent-api-key>" }\n    }\n  }\n}\n\nWorkflow tools:\n- cerebra_create_case\n- cerebra_enqueue_court\n- cerebra_get_job\n- cerebra_get_report\n- cerebra_save_strategy\n- cerebra_recall_memory\n- cerebra_save_checkpoint',
  browser: 'Tool: create_cerebra_case_and_run_court\n\nInput:\n  asset · market · timeframe\n  riskLevel · summary\n\nReturns:\n  runId · verdict · status\n  dissentingJudgeIds',
} as const;

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
  const [asset, setAsset] = useState('TSLAUSDT');
  const [market, setMarket] = useState('usdt-futures');
  const [timeframe, setTimeframe] = useState('4h');
  const [riskLevel, setRiskLevel] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [summary, setSummary] = useState('Evaluate a provisional TSLA long thesis across the next four hours of the tokenized trading session.');
  const [phase, setPhase] = useState<RunPhase>('IDLE');
  const [result, setResult] = useState<CourtRunResult>(sampleReport);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [copiedGuide, setCopiedGuide] = useState<keyof typeof agentGuideSnippets | null>(null);
  const isRunning = phase === 'COLLECTING' || phase === 'ANALYSING';
  const verdict = result.report.verdict ?? 'NO VERDICT';

  async function copyAgentGuide(guide: keyof typeof agentGuideSnippets) {
    await navigator.clipboard.writeText(agentGuideSnippets[guide]);
    setCopiedGuide(guide);
  }

  async function loadCases() {
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
      description: 'Create a stock or digital-asset thesis, gather Bitget market evidence, run the multi-agent court, and return its verdict and dissent.',
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
        const run = await executeCourt(candidate as unknown as CourtInput);
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
        body: JSON.stringify({
          proposal: { asset: input.asset.trim().toUpperCase(), market: input.market, timeframe: input.timeframe, summary: input.summary.trim() },
          riskLevel: input.riskLevel,
          evidenceMode: 'BITGET',
        }),
      });
      setCases((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setConnected(true);
      setPhase('ANALYSING');
      const job = await cerebraApi<CourtJob>(`/v1/cases/${created.id}/jobs`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ refreshEvidence: false }),
      });
      let current = job;
      for (let attempt = 0; attempt < 180 && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(current.status); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        current = await cerebraApi<CourtJob>(`/v1/jobs/${job.id}`);
      }
      if (current.status !== 'COMPLETED' || !current.runId) {
        throw new Error(current.error ?? `Court job ended with ${current.status}.`);
      }
      const runRecord = await cerebraApi<CourtRunRecord>(`/v1/runs/${current.runId}`);
      if (!runRecord.result) throw new Error('The completed court job did not contain a result.');
      const run = runRecord.result;
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
    anchor.href = url;
    anchor.download = `${result.report.reportId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="cerebra-preview-shell">
        <header className="command-nav">
          <a className="command-brand" href="#top" aria-label="Cerebra home"><BrandMark /><span>CEREBRA</span></a>
          <div className="command-nav__meta" aria-label="System status"><span>STOCK DECISION INFRASTRUCTURE</span><span className={connected ? 'is-connected' : ''}>{connected ? 'MARKET FEED LIVE' : 'PREVIEW MODE'}</span></div>
          <div className="command-nav__actions">
            <button className="command-control" aria-label="Search cases" onClick={() => setSidebarOpen(true)}><Search /></button>
            <Link className="command-control" aria-label="Open agent documentation" href="/docs/agents"><BookOpen /></Link>
            <Link className="command-control" aria-label="Open agent identity portal" href="/agents"><Fingerprint /></Link>
            <button className="command-control command-control--history" aria-label="View case history" onClick={() => setSidebarOpen(true)}><History /></button>
            <button className="command-primary" onClick={() => document.getElementById('case-input')?.scrollIntoView({ behavior: 'smooth' })}>Review stock <ArrowDownRight /></button>
          </div>
        </header>

        <section className="hero-stage" id="top">
          <div className="hero-copy">
            <div className="technical-kicker"><span>AI TRADING DESK / COURT 01</span><i /></div>
            <h1>Trade ideas,<br />put under<br /><span>cross-examination.</span></h1>
            <p>Cerebra is a multi-agent stock decision court. It gathers Bitget market intelligence, challenges the thesis, and records three independent votes before capital moves.</p>
            <div className="hero-actions">
              <button className="text-action" onClick={() => document.getElementById('case-input')?.scrollIntoView({ behavior: 'smooth' })}>Review a stock thesis <ArrowRight /></button>
              <span><i /> U.S. STOCKS · DIGITAL ASSETS · HUMAN FINAL CALL</span>
            </div>
          </div>
          <div className="court-core" aria-label="Cerebra court status">
            <div className="core-grid" aria-hidden="true" />
            <div className="core-panel">
              <div className="core-panel__head"><div><small>TOKENIZED STOCK COURT</small><strong>{result.report.proposal.id}</strong></div><span className="status-badge"><i /> MARKET LIVE</span></div>
              <div className="core-verdict"><span>LATEST VERDICT</span><strong>{verdict}</strong><small>{result.report.tally.approve} APPROVE / {result.report.tally.reject} REJECT</small></div>
              <div className="judge-orbit" aria-label="Three judge votes">
                {result.report.judges.map((judge, index) => (
                  <div className={`orbit-node ${judge.opinionType === 'DISSENT' ? 'is-dissent' : ''}`} key={judge.judgeId}><span>0{index + 1}</span><strong>{judge.lens}</strong><small>{judge.vote}</small></div>
                ))}
              </div>
              <div className="core-panel__foot"><span>BITGET MARKET EVIDENCE</span><i /><span>{result.report.evidence.length} SOURCE VERIFIED</span></div>
            </div>
          </div>
        </section>
      </div>

      <section className="landing-manifesto" aria-labelledby="what-cerebra-builds">
        <div className="landing-manifesto__inner">
          <div className="chapter-label chapter-label--light"><span>01</span><i /><strong>WHAT WE BUILD</strong></div>
          <div className="manifesto-grid">
            <div>
              <p className="manifesto-overline">STOCK DECISION INFRASTRUCTURE / NOT ANOTHER SIGNAL BOT</p>
              <h2 id="what-cerebra-builds">A court for<br />consequential<br />trade ideas.</h2>
            </div>
            <div className="manifesto-copy">
              <p>Cerebra turns a stock thesis into an accountable proceeding. Bitget market evidence enters once. An analyst argues the case, a challenger attacks it, and three independent judges examine risk, evidence, and strategy before the trader decides.</p>
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
            <h2 id="problem-title">One prompt.<br />One answer.<br /><span>Zero accountability.</span></h2>
            <div><p>Most market copilots compress noisy evidence into a single confident response. There is no adversary, no independent vote, no durable memory, and no way to see which disagreement was erased.</p><small>CONFIDENCE IS NOT CONSENSUS.</small></div>
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
                <li><span>04</span>The full proceeding persists for future agents</li>
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
            <h2 id="architecture-title">From market signal<br />to reasoned ruling.</h2>
            <div><span>{'// AI TRADING DESK 001'}</span><p>A controlled pipeline links tokenized-stock evidence from Bitget, Claude-powered analysis, an adversarial challenge, three judge lenses, and a persistent court record.</p></div>
          </div>
          <div className="architecture-rail">
            <article><span>01 / INGEST</span><h3>Stock intelligence enters.</h3><p>Quotes, order-book depth and candles are collected through read-only Bitget infrastructure and sealed with source metadata.</p><small>BITGET · READ ONLY</small></article>
            <article><span>02 / CHALLENGE</span><h3>The thesis is attacked.</h3><p>An analyst constructs the case while a challenger tests catalysts, liquidity, timing, assumptions and failure modes.</p><small>CLAUDE · ADVERSARIAL</small></article>
            <article><span>03 / JUDGE</span><h3>Three lenses decide.</h3><p>Risk, evidence, and strategy judges vote independently before a majority verdict is assembled.</p><small>3 NODES · ISOLATED</small></article>
            <article><span>04 / RECORD</span><h3>The decision survives.</h3><p>The report stores intelligence, arguments, every ballot, confidence, citations and the minority opinion in persistent memory.</p><small>MEMORY · PERSISTENT</small></article>
          </div>
          <div className="architecture-cta">
            <div><span>READY / TSLA CASE / 03 JUDGES ONLINE</span><i /></div>
            <button onClick={() => document.getElementById('case-input')?.scrollIntoView({ behavior: 'smooth' })}>Enter the court <ArrowRight /></button>
          </div>
        </div>
      </section>

      <section className="advantage-section" aria-labelledby="advantage-title">
        <div className="advantage-section__inner">
          <div className="chapter-label chapter-label--light"><span>04</span><i /><strong>WHY CEREBRA</strong></div>
          <div className="advantage-heading">
            <h2 id="advantage-title">Not a signal.<br />A decision layer.</h2>
            <p>Cerebra gives trading agents the infrastructure they are usually missing: durable context, structured disagreement, reproducible rulings, and a human safety boundary.</p>
          </div>

          <div className="feature-lattice">
            <article><span>01</span><div><small>MEMORY / DURABLE</small><h3>Persistent market memory</h3><p>Cases, strategy versions, sealed evidence, ballots, dissent and outcomes remain available after the chat or agent restarts.</p></div><code>RECALL_READY</code></article>
            <article><span>02</span><div><small>AGENT INTERFACE / MCP + HTTP</small><h3>Decision Kit</h3><p>External agents can submit a stock thesis, run the court, retrieve the ruling and continue from the same accountable record.</p></div><code>AGENT_NATIVE</code></article>
            <article><span>03</span><div><small>INTELLIGENCE / ADVERSARIAL</small><h3>Analyst versus Challenger</h3><p>One agent assembles the argument; another searches for contradictions, stale evidence, hidden assumptions and failure scenarios.</p></div><code>CROSS_EXAM</code></article>
            <article><span>04</span><div><small>COURT / 3 ISOLATED BALLOTS</small><h3>Three-judge decision court</h3><p>Risk, evidence and strategy judges vote independently. Software tallies the majority without giving one model an override.</p></div><code>2_OF_3</code></article>
            <article><span>05</span><div><small>PROVENANCE / SEALED</small><h3>Evidence intelligence ledger</h3><p>Every fact carries its source, observation time, evidence ID and digest so the ruling can be traced back to the market packet.</p></div><code>TRACEABLE</code></article>
            <article><span>06</span><div><small>SAFETY / HUMAN CONTROL</small><h3>Human final-decision gate</h3><p>Cerebra analyzes and stress-tests. It does not present an advisory ruling as guaranteed profit or silently place the trade.</p></div><code>NO_AUTO_ORDER</code></article>
          </div>

          <div className="hackathon-fit">
            <div className="hackathon-fit__lead">
              <span>BITGET AI · GENESIS SEASON 2</span>
              <h3>Built for the<br />AI Trading Desk.</h3>
              <p>Decision stress-testing for tokenized U.S. stocks and digital assets, grounded in Bitget market evidence.</p>
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
            <h2 id="agent-connect-title">One layer.<br />Three ways in.</h2>
            <div>
              <p>Give your trading agent a Cerebra API origin. It can submit a stock thesis, gather Bitget evidence, convene the court, and retrieve the complete Decision Kit.</p>
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
                  <h3>The complete persistent workflow.</h3>
                  <p>Use HTTP when an agent needs to create a case, refresh evidence, run all five reasoning roles, and retrieve the ruling later from persistent memory.</p>
                  <strong><i /> BACKEND ROUTE READY</strong>
                </div>
                <ol className="connection-steps">
                  <li><span>01</span><div><strong>Create the case</strong><p>Send the symbol, market, horizon, risk posture and thesis.</p></div></li>
                  <li><span>02</span><div><strong>Run the court</strong><p>Cerebra collects Bitget evidence and starts Analyst, Challenger and Judge agents.</p></div></li>
                  <li><span>03</span><div><strong>Read the Decision Kit</strong><p>Retrieve evidence, arguments, three ballots, dissent and execution trace.</p></div></li>
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
          )) : sampleCases.map((item) => (
            <button className={`case-row ${item.id === 'sample-tsla' ? 'is-selected' : ''}`} key={item.id} onClick={() => { setResult(sampleReport); setSidebarOpen(false); }}>
              <span className="asset-token">{item.asset.slice(0, 2)}</span>
              <span className="case-row__copy"><strong>{item.asset}</strong><small>{item.votes} · {item.time} ago</small></span>
              <span className={`status-dot tone-${statusTone(item.status)}`} />
            </button>
          ))}
        </nav>
        <div className="drawer-foot"><Database /><span><strong>{connected ? 'API connected' : 'Preview data'}</strong><small>{connected ? 'Persistent case memory online' : 'Connect backend for live memory'}</small></span><i className={connected ? 'is-live' : ''} /></div>
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
            <div className="machine-index"><span>CASE CONFIGURATION</span><strong>INPUT / 001</strong></div>
            <div className="machine-fields">
              <label className="field" htmlFor="case-asset"><span>01 / Stock or asset symbol</span><Input id="case-asset" value={asset} onChange={(event) => setAsset(event.target.value)} placeholder="TSLAUSDT" required /></label>
              <label className="field" htmlFor="case-market"><span>02 / Bitget market</span><NativeSelect id="case-market" className="w-full" value={market} onChange={(event) => setMarket(event.target.value)}><NativeSelectOption value="spot">Crypto spot</NativeSelectOption><NativeSelectOption value="usdt-futures">Tokenized stock / USDT futures</NativeSelectOption></NativeSelect></label>
              <label className="field" htmlFor="case-timeframe"><span>03 / Horizon</span><NativeSelect id="case-timeframe" className="w-full" value={timeframe} onChange={(event) => setTimeframe(event.target.value)}><NativeSelectOption value="15m">15 minutes</NativeSelectOption><NativeSelectOption value="1h">1 hour</NativeSelectOption><NativeSelectOption value="4h">4 hours</NativeSelectOption><NativeSelectOption value="1d">1 day</NativeSelectOption></NativeSelect></label>
              <label className="field" htmlFor="case-risk"><span>04 / Risk posture</span><NativeSelect id="case-risk" className="w-full" value={riskLevel} onChange={(event) => setRiskLevel(event.target.value as typeof riskLevel)}><NativeSelectOption value="LOW">Low</NativeSelectOption><NativeSelectOption value="MEDIUM">Medium</NativeSelectOption><NativeSelectOption value="HIGH">High</NativeSelectOption></NativeSelect></label>
              <label className="field field-thesis" htmlFor="case-summary"><span>05 / Stock thesis and catalyst</span><Textarea id="case-summary" value={summary} onChange={(event) => setSummary(event.target.value)} minLength={10} maxLength={4000} required /></label>
            </div>
            <div className="machine-submit">
              <div className="evidence-source"><Radio /><span><strong>Stock intelligence channel armed</strong><small>Bitget market data · read-only · no order execution</small></span></div>
              <Button type="submit" size="lg" disabled={isRunning}>{isRunning ? <LoaderCircle className="animate-spin" /> : <Gavel />}{phase === 'COLLECTING' ? 'Gathering evidence' : phase === 'ANALYSING' ? 'Court deliberating' : 'Convene court'}{!isRunning ? <ArrowRight /> : null}</Button>
            </div>
          </form>
          {error ? <div className="error-banner" role="alert"><CircleAlert /><span><strong>The court did not complete this run.</strong>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error"><X /></button></div> : null}
        </section>

        <section className="system-section intelligence-section">
          <div className="chapter-label"><span>02</span><i /><strong>INTELLIGENCE</strong></div>
          <div className="ruling-toolbar">
            <div><p className="eyebrow">Latest proceeding</p><div className="ruling-title-row"><h2>{result.report.proposal.id}</h2><Badge variant="outline">{result.provider} · {result.model}</Badge></div></div>
            <div className="ruling-actions"><span className={`live-status ${connected ? 'is-live' : ''}`}><i /> {connected ? 'System live' : 'Preview data'}</span><Button variant="outline" size="sm" onClick={() => void loadCases()}><RefreshCw /> Sync</Button><Button variant="outline" size="sm" onClick={downloadReport}><Download /> Export</Button></div>
          </div>
          <div className="deliberation-module">
            <div className="module-grid" aria-hidden="true" />
            <Pipeline phase={phase === 'IDLE' ? 'COMPLETE' : phase} />
            <div className="verdict-grid">
              <div className={`verdict-card verdict-${verdict.toLowerCase().replace(' ', '-')}`}><div className="verdict-seal"><Scale /></div><div><p>Ruling of the court</p><h3>{verdict}</h3><span>{result.report.status} · {result.report.tally.approve} approve / {result.report.tally.reject} reject</span></div></div>
              <div className="decision-note"><span className="quote-mark">“</span><p>{result.report.proposal.summary}</p><div><Activity /> Completed in {Math.max(1, Math.round((new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime()) / 1000))} seconds</div></div>
            </div>
          </div>
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
          <div className="section-statement section-statement--judges"><h2>Three lenses.<br />One accountable record.</h2><p>Risk, evidence, and strategy judges deliberate independently. The minority reasoning stays visible instead of being averaged away.</p></div>
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

        <section className="system-section transaction-section" aria-labelledby="transaction-title">
          <div className="chapter-label"><span>05</span><i /><strong>AGENT TRANSACTION</strong></div>
          <div className="section-statement transaction-heading">
            <h2 id="transaction-title">A request enters.<br />A decision returns.</h2>
            <p>The complete Cerebra transaction, from a trading agent’s first thesis to a portable Decision Kit—with every reasoning boundary visible.</p>
          </div>

          <div className="transaction-slate">
            <div className="transaction-slate__top">
              <span><i /> TRACE / RUN_TSLA_4H</span>
              <strong>07 STAGES · HUMAN-GATED</strong>
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
