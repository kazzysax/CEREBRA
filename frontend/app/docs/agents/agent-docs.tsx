'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BookOpen, Check, Clipboard, ExternalLink, Radio, ShieldCheck, Waypoints } from 'lucide-react';
import { BrandMark } from '@/components/court-panel';

const snippets = {
  register: 'POST ${CEREBRA_API_URL}/v1/agents/register\nContent-Type: application/json\nX-Cerebra-Registration-Token: <registration-token>\n\n{\n  "name": "atlas-trader",\n  "description": "Research agent for tokenized U.S. stocks",\n  "capabilities": ["stock-research", "risk-review"]\n}',
  case: 'POST ${CEREBRA_API_URL}/v1/cases\nAuthorization: Bearer <agent-api-key>\nContent-Type: application/json\n\n{\n  "proposal": {\n    "asset": "TSLAUSDT",\n    "market": "usdt-futures",\n    "timeframe": "4h",\n    "summary": "Evaluate a provisional TSLA long thesis."\n  },\n  "riskLevel": "MEDIUM",\n  "evidenceMode": "BITGET"\n}',
  run: 'POST ${CEREBRA_API_URL}/v1/cases/{caseId}/run\nAuthorization: Bearer <agent-api-key>\nContent-Type: application/json\n\n{ "refreshEvidence": true }',
  report: 'GET ${CEREBRA_API_URL}/v1/runs/{runId}/report\nAuthorization: Bearer <agent-api-key>',
  mcp: '{\n  "mcpServers": {\n    "cerebra": {\n      "url": "${CEREBRA_API_URL}/mcp",\n      "headers": {\n        "Authorization": "Bearer <agent-api-key>"\n      }\n    }\n  }\n}',
} as const;

type Snippet = keyof typeof snippets;

function CodeBlock({ name, label }: { name: Snippet; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(snippets[name]);
    setCopied(true);
  }

  return (
    <div className="docs-code">
      <div className="docs-code__bar"><span>{label}</span><button onClick={() => void copy()}>{copied ? <Check /> : <Clipboard />}{copied ? 'Copied' : 'Copy'}</button></div>
      <pre><code>{snippets[name]}</code></pre>
    </div>
  );
}

const endpoints = [
  ['POST', '/v1/agents/register', 'Register an agent identity and receive its API key once.'],
  ['GET', '/v1/agents/me', 'Verify the current agent identity and its active capabilities.'],
  ['POST', '/v1/agents/me/keys/rotate', 'Invalidate the previous key and issue a replacement.'],
  ['POST', '/v1/cases', 'Create an owner-scoped stock case and collect its evidence packet.'],
  ['GET', '/v1/cases', 'List only the cases belonging to the authenticated agent.'],
  ['POST', '/v1/cases/:id/run', 'Refresh evidence and convene the complete five-agent court.'],
  ['GET', '/v1/runs/:id', 'Read execution state, provider, timing and the complete result.'],
  ['GET', '/v1/runs/:id/report', 'Retrieve the portable ruling, Markdown report and dissent.'],
] as const;

export function AgentDocs() {
  return (
    <main className="agent-docs">
      <header className="docs-nav">
        <Link className="command-brand" href="/" aria-label="Return to Cerebra"><BrandMark /><span>CEREBRA</span></Link>
        <span>AGENT DOCUMENTATION / V1</span>
        <Link href="/#agent-connect">Connection overview <ArrowLeft /></Link>
      </header>

      <div className="docs-layout">
        <aside className="docs-sidebar" aria-label="Documentation navigation">
          <p>CONNECT AN AGENT</p>
          <nav>
            <a href="#overview">Overview</a>
            <a href="#quickstart">Quickstart</a>
            <a href="#identity">Identity and keys</a>
            <a href="#http">HTTP API</a>
            <a href="#report">Decision Kit</a>
            <a href="#mcp">MCP</a>
            <a href="#browser">Browser tool</a>
            <a href="#errors">Errors</a>
            <a href="#boundary">Safety boundary</a>
          </nav>
          <div><i /><span>DOCUMENT STATUS</span><strong>IMPLEMENTED CONTRACT</strong></div>
        </aside>

        <article className="docs-content">
          <section className="docs-hero" id="overview">
            <div className="technical-kicker"><span>DECISION KIT / AGENT ACCESS</span><i /></div>
            <h1>Connect an agent<br />to the court.</h1>
            <p>Cerebra accepts a trade thesis, seals market evidence, runs an adversarial five-agent proceeding, and returns a structured ruling without placing an order.</p>
            <div className="docs-status-grid">
              <div><span>PRIMARY INTERFACE</span><strong>HTTP JSON API</strong></div>
              <div><span>ALTERNATIVE</span><strong>MCP + WEBMCP</strong></div>
              <div><span>AUTHENTICATION</span><strong>BEARER AGENT KEY</strong></div>
              <div><span>EXECUTION</span><strong>HUMAN-GATED</strong></div>
            </div>
          </section>

          <section className="docs-section docs-callout">
            <Radio /><div><span>BASE URL</span><h2>Use your deployed Cerebra API origin.</h2><p>Replace <code>{'${CEREBRA_API_URL}'}</code> in every example. Never send an agent key to the frontend bundle or commit it to source control.</p></div>
          </section>

          <section className="docs-section" id="quickstart">
            <div className="docs-section__label"><span>01</span><i /><strong>QUICKSTART</strong></div>
            <h2>From registration<br />to ruling.</h2>
            <div className="docs-step-grid">
              <article><span>01</span><h3>Register</h3><p>Create an agent identity. Store the returned secret immediately—it is shown only once.</p></article>
              <article><span>02</span><h3>Create case</h3><p>Submit a symbol, market, horizon, risk posture and evidence mode.</p></article>
              <article><span>03</span><h3>Run court</h3><p>Trigger Bitget evidence, Analyst, Challenger and three isolated judges.</p></article>
              <article><span>04</span><h3>Read report</h3><p>Use the run ID to retrieve every claim, objection, ballot and dissent.</p></article>
            </div>
          </section>

          <section className="docs-section" id="identity">
            <div className="docs-section__label"><span>02</span><i /><strong>IDENTITY AND KEYS</strong></div>
            <div className="docs-two-column">
              <div><h2>Every request has an owner.</h2><p>An agent identity binds cases, runs and reports to one durable owner. In production, registration is protected by a bootstrap registration token. After registration, the agent authenticates with its bearer key.</p></div>
              <div className="docs-spec-list">
                <div><span>AGENT ID</span><strong>Stable UUID</strong></div>
                <div><span>SECRET FORMAT</span><strong>cba_live_…</strong></div>
                <div><span>STORAGE</span><strong>HMAC hash only</strong></div>
                <div><span>ROTATION</span><strong>Immediate revocation</strong></div>
              </div>
            </div>
            <CodeBlock name="register" label="REGISTER_AGENT.HTTP" />
          </section>

          <section className="docs-section" id="http">
            <div className="docs-section__label"><span>03</span><i /><strong>HTTP DECISION KIT</strong></div>
            <h2>The recommended<br />integration path.</h2>
            <div className="docs-api-list">
              {endpoints.map(([method, path, description]) => <div key={path + method}><span className={method === 'GET' ? 'is-get' : ''}>{method}</span><code>{path}</code><p>{description}</p></div>)}
            </div>
            <div className="docs-code-stack">
              <CodeBlock name="case" label="CREATE_CASE.HTTP" />
              <CodeBlock name="run" label="RUN_COURT.HTTP" />
              <CodeBlock name="report" label="GET_REPORT.HTTP" />
            </div>
          </section>

          <section className="docs-section" id="report">
            <div className="docs-section__label"><span>04</span><i /><strong>DECISION KIT RESPONSE</strong></div>
            <h2>One response.<br />The whole proceeding.</h2>
            <div className="docs-contract-grid">
              <article><span>ANALYST CASE</span><p>Recommendation, confidence, thesis, cited claims and explicit risks.</p></article>
              <article><span>CHALLENGE</span><p>Conclusion, severity-ranked objections and missing evidence.</p></article>
              <article><span>RULING REPORT</span><p>Verdict, tally, three judge opinions, reason codes and dissent IDs.</p></article>
              <article><span>TRACE</span><p>Every model stage, provider, status, usage and captured error.</p></article>
            </div>
          </section>

          <section className="docs-section" id="mcp">
            <div className="docs-section__label"><span>05</span><i /><strong>MODEL CONTEXT PROTOCOL</strong></div>
            <div className="docs-two-column">
              <div><h2>Discover the court as tools.</h2><p>Connect an MCP-compatible client to <code>/mcp</code>. The server publishes typed case creation, court execution, report retrieval and service-status tools backed by the same persistent Decision Kit.</p></div>
              <div className="docs-tool-list"><span>cerebra_status</span><span>cerebra_create_case</span><span>cerebra_run_court</span><span>cerebra_get_report</span></div>
            </div>
            <CodeBlock name="mcp" label="MCP_CLIENT.JSON" />
          </section>

          <section className="docs-section" id="browser">
            <div className="docs-section__label"><span>06</span><i /><strong>BROWSER AGENT</strong></div>
            <div className="docs-browser-card">
              <Waypoints /><div><span>WEBMCP TOOL</span><h2>create_cerebra_case_and_run_court</h2><p>The Cerebra interface registers one browser-level tool accepting asset, market, timeframe, risk level and thesis. It returns the run ID, verdict, court status and dissenting judge IDs.</p></div>
            </div>
          </section>

          <section className="docs-section" id="errors">
            <div className="docs-section__label"><span>07</span><i /><strong>ERROR CONTRACT</strong></div>
            <div className="docs-error-grid">
              <article><strong>400</strong><span>INVALID_REQUEST</span><p>The input failed schema validation. Inspect the returned issue paths.</p></article>
              <article><strong>401</strong><span>UNAUTHORIZED</span><p>The bearer key is missing, invalid, rotated or revoked.</p></article>
              <article><strong>404</strong><span>NOT_FOUND</span><p>The record does not exist or belongs to another agent identity.</p></article>
              <article><strong>502</strong><span>UPSTREAM_FAILURE</span><p>Evidence or model execution failed. Preserve the run ID for diagnosis.</p></article>
            </div>
          </section>

          <section className="docs-section docs-boundary" id="boundary">
            <ShieldCheck />
            <div><span>NON-CUSTODIAL DECISION LAYER</span><h2>Cerebra never silently places the trade.</h2><p>The Decision Kit is an advisory artifact. A human or separately governed execution service must review the ruling and authorize capital movement.</p></div>
          </section>

          <footer className="docs-footer"><div><BookOpen /><span>END / AGENT CONNECTION</span></div><Link href="/">Return to Cerebra <ArrowRight /></Link><a href="https://www.bitget.com/activity-hub/agent-hub" target="_blank" rel="noreferrer">Bitget Agent Hub <ExternalLink /></a></footer>
        </article>
      </div>
    </main>
  );
}
