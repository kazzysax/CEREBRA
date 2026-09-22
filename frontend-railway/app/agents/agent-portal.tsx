'use client';

import { SyntheticEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Clipboard, Download, Fingerprint, KeyRound, LogOut, MemoryStick, Plus, RefreshCw, RotateCw, Save, ShieldCheck } from 'lucide-react';
import { BrandMark } from '@/components/court-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { agentHeaders, cerebraApi, clearSessionAgentKey, saveSessionAgentKey, shortDate, type CourtRunRecord } from '@/lib/cerebra';

type Agent = { id: string; name: string; description: string; capabilities: string[]; status: 'ACTIVE' | 'REVOKED'; keyPrefix: string; createdAt: string; lastSeenAt: string | null };
type Strategy = { id: string; asset: string; timeframe: string; thesis: string; version: number; status: 'ACTIVE' | 'SUPERSEDED'; createdAt: string };
type Impression = { id: string; asset: string; statement: string; confidence: number; validUntil: string | null; isExpired: boolean; createdAt: string };
type Checkpoint = { id: string; schemaVersion: string; state: Record<string, unknown>; reconciliationRequired: boolean; lastAcknowledgedActionId: string | null; createdAt: string };

export function AgentPortal() {
  const [mode, setMode] = useState<'connect' | 'register'>('connect');
  const [apiKey, setApiKey] = useState('');
  const [registrationToken, setRegistrationToken] = useState('');
  const [name, setName] = useState('atlas-research-agent');
  const [description, setDescription] = useState('Stock research agent using Cerebra for adversarial review.');
  const [agent, setAgent] = useState<Agent | null>(null);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [impressions, setImpressions] = useState<Impression[]>([]);
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [runs, setRuns] = useState<CourtRunRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<CourtRunRecord | null>(null);
  const [calibration, setCalibration] = useState<Array<{ judgeId: string; resolved: number; correct: number; incorrect: number; accuracy: number | null }>>([]);
  const [asset, setAsset] = useState('TSLAUSDT');
  const [timeframe, setTimeframe] = useState('4h');
  const [thesis, setThesis] = useState('Evaluate a bounded TSLA thesis while monitoring tokenized-market liquidity and a defined invalidation level.');
  const [impression, setImpression] = useState('Tokenized-session liquidity may diverge from the primary U.S. listing.');
  const [confidence, setConfidence] = useState('0.72');
  const [checkpointState, setCheckpointState] = useState('{\n  "phase": "awaiting-human-review",\n  "lastRunId": null\n}');

  const headers = agentHeaders(apiKey);

  async function loadMemory(key = apiKey, targetAsset = asset) {
    const auth = agentHeaders(key);
    const [strategyResponse, recallResponse] = await Promise.all([
      cerebraApi<{ strategies: Strategy[] }>('/v1/memory/strategies?limit=20', { headers: auth }),
      cerebraApi<{ impressions: Impression[] }>('/v1/memory/recall?asset=' + encodeURIComponent(targetAsset), { headers: auth }),
    ]);
    setStrategies(strategyResponse.strategies);
    setImpressions(recallResponse.impressions);
    try {
      setCheckpoint(await cerebraApi<Checkpoint>('/v1/memory/checkpoints/latest', { headers: auth }));
    } catch { setCheckpoint(null); }
  }

  async function loadWorkspace(key = apiKey) {
    const auth = agentHeaders(key);
    const [history, judgeCalibration] = await Promise.all([
      cerebraApi<{ runs: CourtRunRecord[] }>('/v1/runs?limit=25', { headers: auth }),
      cerebraApi<{ judges: Array<{ judgeId: string; resolved: number; correct: number; incorrect: number; accuracy: number | null }> }>('/v1/judges/calibration', { headers: auth }),
    ]);
    setRuns(history.runs);
    setCalibration(judgeCalibration.judges);
  }

  async function connect(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try {
      const profile = await cerebraApi<Agent>('/v1/agents/me', { headers: agentHeaders(apiKey) });
      setAgent(profile); saveSessionAgentKey(apiKey); setIssuedKey(null); await Promise.all([loadMemory(apiKey), loadWorkspace(apiKey)]); setNotice('Identity verified. Your private court history and memory are available.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Agent authentication failed.'); }
    finally { setBusy(false); }
  }

  async function register(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try {
      const response = await cerebraApi<{ agent: Agent; apiKey: string }>('/v1/agents/register', {
        method: 'POST',
        headers: { 'x-cerebra-registration-token': registrationToken },
        body: JSON.stringify({ name, description, capabilities: ['stock-research', 'risk-review', 'persistent-memory'] }),
      });
      setAgent(response.agent); setApiKey(response.apiKey); saveSessionAgentKey(response.apiKey); setIssuedKey(response.apiKey);
      await Promise.all([loadMemory(response.apiKey), loadWorkspace(response.apiKey)]); setNotice('Agent registered. Copy the key now; Cerebra will not show it again.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Agent registration failed.'); }
    finally { setBusy(false); }
  }

  async function rotateKey() {
    setBusy(true); setError(null);
    try {
      const response = await cerebraApi<{ agent: Agent; apiKey: string }>('/v1/agents/me/keys/rotate', { method: 'POST', headers, body: '{}' });
      setAgent(response.agent); setApiKey(response.apiKey); saveSessionAgentKey(response.apiKey); setIssuedKey(response.apiKey); setNotice('The previous key is invalid. Copy the replacement now.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Key rotation failed.'); }
    finally { setBusy(false); }
  }

  async function revoke() {
    setBusy(true); setError(null);
    try {
      await cerebraApi('/v1/agents/me/revoke', { method: 'POST', headers, body: '{}' });
      setAgent(null); setApiKey(''); clearSessionAgentKey(); setIssuedKey(null); setStrategies([]); setImpressions([]); setCheckpoint(null); setRuns([]); setSelectedRun(null); setCalibration([]); setNotice('Agent revoked. Its key can no longer access Cerebra.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Revocation failed.'); }
    finally { setBusy(false); }
  }

  async function saveStrategy(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const active = strategies.find((item) => item.asset === asset.toUpperCase() && item.status === 'ACTIVE');
      await cerebraApi('/v1/memory/strategies', { method: 'POST', headers, body: JSON.stringify({ asset, timeframe, thesis, parentVersionId: active?.id ?? null, constraints: ['Human final decision required'], invalidationConditions: ['Evidence becomes stale or liquidity deteriorates'] }) });
      await loadMemory(); setNotice('A new immutable strategy version was saved.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Strategy save failed.'); }
    finally { setBusy(false); }
  }

  async function saveImpression(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const active = strategies.find((item) => item.asset === asset.toUpperCase() && item.status === 'ACTIVE');
      await cerebraApi('/v1/memory/impressions', { method: 'POST', headers, body: JSON.stringify({ strategyVersionId: active?.id ?? null, asset, statement: impression, confidence: Number(confidence), evidenceIds: [] }) });
      await loadMemory(); setNotice('The timestamped impression is now available to future reviews.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Impression save failed.'); }
    finally { setBusy(false); }
  }

  async function saveCheckpoint(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const state = JSON.parse(checkpointState) as Record<string, unknown>;
      const active = strategies.find((item) => item.asset === asset.toUpperCase() && item.status === 'ACTIVE');
      await cerebraApi('/v1/memory/checkpoints', { method: 'POST', headers, body: JSON.stringify({ strategyVersionId: active?.id ?? null, state, reconciliationRequired: true }) });
      await loadMemory(); setNotice('Checkpoint saved. External actions must be reconciled before replay.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Checkpoint save failed.'); }
    finally { setBusy(false); }
  }

  async function copyKey() {
    if (!issuedKey) return; await navigator.clipboard.writeText(issuedKey); setCopied(true);
  }

  function exportRun(run: CourtRunRecord) {
    if (!run.result) return;
    const blob = new Blob([JSON.stringify(run.result, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `cerebra-ruling-${run.id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <main className="identity-portal">
      <header className="portal-nav"><Link className="command-brand" href="/"><BrandMark /><span>CEREBRA</span></Link><span>IDENTITY CONTROL / MEMORY NODE</span><Link href="/"><ArrowLeft /> Return to court</Link></header>
      <section className="portal-shell">
        <div className="portal-heading"><div><span>AGENT SYSTEM / 004</span><h1>Identity that<br />survives the session.</h1></div><p>Register or verify an agent, rotate its credentials, and preserve the strategies, impressions and recovery state that future court proceedings need.</p></div>

        {!agent ? (
          <section className="identity-gate">
            <div className="identity-gate__visual"><Fingerprint /><span>AUTHENTICATION PLANE</span><h2>One key.<br />One owner.<br />No shared memory.</h2><p>Keys remain in this page’s memory only and are never embedded in the Cerebra frontend bundle.</p></div>
            <div className="identity-gate__form">
              <div className="portal-switch"><button className={mode === 'connect' ? 'is-active' : ''} onClick={() => setMode('connect')}>Connect existing</button><button className={mode === 'register' ? 'is-active' : ''} onClick={() => setMode('register')}>Register agent</button></div>
              {mode === 'connect' ? <form onSubmit={connect}><label htmlFor="portal-api-key"><span>AGENT API KEY</span><Input id="portal-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="cba_live_…" required /></label><Button type="submit" disabled={busy || !apiKey}>{busy ? <RefreshCw className="portal-spin" /> : <KeyRound />} Verify identity</Button></form> : <form onSubmit={register}><label htmlFor="portal-agent-name"><span>AGENT NAME</span><Input id="portal-agent-name" value={name} onChange={(event) => setName(event.target.value)} required /></label><label htmlFor="portal-description"><span>DESCRIPTION</span><Textarea id="portal-description" value={description} onChange={(event) => setDescription(event.target.value)} /></label><label htmlFor="portal-registration-token"><span>REGISTRATION TOKEN</span><Input id="portal-registration-token" type="password" value={registrationToken} onChange={(event) => setRegistrationToken(event.target.value)} required /></label><Button type="submit" disabled={busy}><Plus /> Create identity</Button></form>}
              {notice ? <p className="portal-notice is-ok">{notice}</p> : null}{error ? <p className="portal-notice is-error">{error}</p> : null}
            </div>
          </section>
        ) : (
          <>
            <section className="identity-console">
              <div className="identity-console__profile"><span><i /> AGENT ACTIVE</span><h2>{agent.name}</h2><p>{agent.description || 'No description supplied.'}</p><div><small>ID</small><code>{agent.id}</code><small>KEY</small><code>{agent.keyPrefix}••••</code></div></div>
              <div className="identity-console__metrics"><article><span>CAPABILITIES</span><strong>{agent.capabilities.length.toString().padStart(2, '0')}</strong><small>{agent.capabilities.join(' / ') || 'GENERAL'}</small></article><article><span>STRATEGY VERSIONS</span><strong>{strategies.length.toString().padStart(2, '0')}</strong><small>PERSISTENT / OWNER SCOPED</small></article><article><span>LAST SEEN</span><strong>{agent.lastSeenAt ? shortDate(agent.lastSeenAt) : 'NOW'}</strong><small>AUTHENTICATED SESSION</small></article></div>
              <div className="identity-console__actions"><Button variant="outline" onClick={() => void rotateKey()} disabled={busy}><RotateCw /> Rotate key</Button><Button variant="outline" onClick={() => void revoke()} disabled={busy}><LogOut /> Revoke agent</Button></div>
            </section>

            {issuedKey ? <section className="issued-key"><ShieldCheck /><div><span>ONE-TIME SECRET</span><strong>{issuedKey}</strong><p>Copy this key now. Only its HMAC hash is stored by Cerebra.</p></div><button onClick={() => void copyKey()}>{copied ? <Check /> : <Clipboard />}{copied ? 'Copied' : 'Copy key'}</button></section> : null}
            {notice ? <p className="portal-notice is-ok">{notice}</p> : null}{error ? <p className="portal-notice is-error">{error}</p> : null}

            <section className="court-history">
              <div className="memory-workspace__head"><div><span>PRIVATE CASE ARCHIVE / LIVE</span><h2>Your court<br />history.</h2></div><button onClick={() => void loadWorkspace()}><RefreshCw /> Refresh history</button></div>
              <p className="court-history__intro">Only this agent can see its past proceedings. Reopen a ruling or export its evidence-bound record.</p>
              <div className="court-history__grid">
                <article className="court-history__list">
                  {runs.length ? runs.map((run) => {
                    const report = run.result?.report;
                    return <button key={run.id} className={selectedRun?.id === run.id ? 'is-selected' : ''} onClick={() => setSelectedRun(run)}><span>{report?.proposal.summary?.slice(0, 72) ?? 'Court proceeding'}{report?.proposal.summary && report.proposal.summary.length > 72 ? '…' : ''}</span><small>{report?.status ?? run.status} / {shortDate(run.completedAt ?? run.startedAt)}</small></button>;
                  }) : <p className="ledger-empty">No rulings yet. Run a case from the Court Terminal and it will appear here.</p>}
                </article>
                <article className="court-history__detail">
                  {selectedRun?.result ? <><span>REOPENED RULING / {selectedRun.result.report.status}</span><h3>{selectedRun.result.report.proposal.summary}</h3><p><strong>{selectedRun.result.report.verdict ?? 'NO VERDICT'}</strong> — {selectedRun.result.report.recommendation.rationale}</p><div><code>{selectedRun.result.report.recommendation.status}</code><code>{selectedRun.result.report.recommendation.direction}</code><code>{selectedRun.result.report.tally.approve} APPROVE / {selectedRun.result.report.tally.reject} REJECT</code></div><p className="court-history__advisory">{selectedRun.result.report.recommendation.timing} Invalidation: {selectedRun.result.report.recommendation.invalidation}</p><Button variant="outline" onClick={() => exportRun(selectedRun)}><Download /> Export ruling JSON</Button></> : <p className="ledger-empty">Select a completed proceeding to reopen its ruling.</p>}
                </article>
              </div>
              <div className="court-history__calibration"><span>JUDGE CALIBRATION / RECORDED OUTCOMES</span>{calibration.map((judge) => <div key={judge.judgeId}><strong>{judge.judgeId.replace('judge-', '').toUpperCase()}</strong><small>{judge.resolved ? `${Math.round((judge.accuracy ?? 0) * 100)}% accurate across ${judge.resolved} resolved outcome${judge.resolved === 1 ? '' : 's'}` : 'No recorded outcomes yet'}</small></div>)}</div>
            </section>

            <section className="memory-workspace">
              <div className="memory-workspace__head"><div><span>MEMORY LEDGER / LIVE</span><h2>Version the thesis.<br />Restore the agent.</h2></div><button onClick={() => void loadMemory()}><RefreshCw /> Refresh memory</button></div>
              <div className="memory-forms">
                <form onSubmit={saveStrategy}><div className="memory-form__label"><span>01</span><strong>STRATEGY VERSION</strong></div><label htmlFor="memory-asset"><span>ASSET</span><Input id="memory-asset" value={asset} onChange={(event) => setAsset(event.target.value.toUpperCase())} /></label><label htmlFor="memory-timeframe"><span>TIMEFRAME</span><Input id="memory-timeframe" value={timeframe} onChange={(event) => setTimeframe(event.target.value)} /></label><label htmlFor="memory-thesis"><span>THESIS</span><Textarea id="memory-thesis" value={thesis} onChange={(event) => setThesis(event.target.value)} /></label><Button type="submit" disabled={busy}><Save /> Save new version</Button></form>
                <form onSubmit={saveImpression}><div className="memory-form__label"><span>02</span><strong>MARKET IMPRESSION</strong></div><label htmlFor="memory-impression"><span>STATEMENT</span><Textarea id="memory-impression" value={impression} onChange={(event) => setImpression(event.target.value)} /></label><label htmlFor="memory-confidence"><span>CONFIDENCE / 0–1</span><Input id="memory-confidence" type="number" min="0" max="1" step="0.01" value={confidence} onChange={(event) => setConfidence(event.target.value)} /></label><Button type="submit" disabled={busy}><MemoryStick /> Store impression</Button></form>
                <form onSubmit={saveCheckpoint}><div className="memory-form__label"><span>03</span><strong>RECOVERY CHECKPOINT</strong></div><label htmlFor="checkpoint-json"><span>JSON STATE</span><Textarea id="checkpoint-json" className="portal-code-input" value={checkpointState} onChange={(event) => setCheckpointState(event.target.value)} /></label><Button type="submit" disabled={busy}><Save /> Save checkpoint</Button></form>
              </div>

              <div className="memory-ledger">
                <article><div className="memory-ledger__title"><span>STRATEGY LINEAGE</span><strong>{asset}</strong></div>{strategies.length ? strategies.map((item) => <div className="ledger-row" key={item.id}><span>V{item.version.toString().padStart(2, '0')}</span><div><strong>{item.asset} / {item.timeframe}</strong><p>{item.thesis}</p></div><code className={item.status === 'ACTIVE' ? 'is-active' : ''}>{item.status}</code></div>) : <p className="ledger-empty">No strategy versions stored yet.</p>}</article>
                <article><div className="memory-ledger__title"><span>RECALLED IMPRESSIONS</span><strong>{impressions.length}</strong></div>{impressions.length ? impressions.map((item) => <div className="ledger-row" key={item.id}><span>{Math.round(item.confidence * 100)}%</span><div><strong>{item.asset}</strong><p>{item.statement}</p></div><code className={item.isExpired ? 'is-expired' : 'is-active'}>{item.isExpired ? 'EXPIRED' : 'CURRENT'}</code></div>) : <p className="ledger-empty">No impressions recalled for this asset.</p>}</article>
                <article><div className="memory-ledger__title"><span>LATEST CHECKPOINT</span><strong>{checkpoint ? 'RESTORABLE' : 'EMPTY'}</strong></div>{checkpoint ? <div className="checkpoint-state"><code>{JSON.stringify(checkpoint.state, null, 2)}</code><p><i /> Reconciliation {checkpoint.reconciliationRequired ? 'required' : 'complete'} before external-action replay.</p></div> : <p className="ledger-empty">No recovery checkpoint stored yet.</p>}</article>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
