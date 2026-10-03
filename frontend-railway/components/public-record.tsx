'use client';

import './public-record.css';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, TriangleAlert } from 'lucide-react';
import { cerebraApi, type PublicEntry, type PublicScore, type PublicTrackRecord, type PublicVerification } from '@/lib/cerebra';

const fmtPrice = (value: number | null | undefined) => (value === null || value === undefined ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 4 }));
const fmtTime = (value: string) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(value));
const shortHash = (hash: string | null) => (hash ? hash.replace('sha256:', '').slice(0, 12) + '…' : '—');

function verdictLabel(entry: PublicEntry) {
  if (entry.status === 'MISSED') return 'SLOT MISSED';
  if (entry.recommendation?.status === 'ACTIONABLE') return `${entry.recommendation.direction} ADVISED`;
  return entry.verdict === 'APPROVE' ? 'APPROVED · NOT ACTIONABLE' : 'NO TRADE';
}

function voteLine(entry: PublicEntry) {
  const tally = entry.tally;
  if (!tally) return '';
  if (entry.recommendation?.source === 'ALTERNATIVE') {
    return `Submitted thesis rejected ${tally.approve}–${tally.reject}; the court's alternative was backed by ${entry.alternativeTally?.approve ?? 0} of 3 judges`;
  }
  if (entry.recommendation?.status === 'ACTIONABLE') return `${tally.approve} of 3 judges backed it`;
  return tally.approve >= 2 ? `${tally.approve} of 3 judges approved, but the plan was not actionable` : `${tally.reject} of 3 judges rejected it`;
}

function scoreLine(entry: PublicEntry, score: PublicScore | null) {
  if (entry.status === 'MISSED') return { tone: 'muted', text: 'No ruling was produced for this slot, and the record says so.' };
  if (!score) return { tone: 'muted', text: `Pending: scored from Bitget candles once the ${entry.timeframe?.toUpperCase() ?? '4H'} horizon has passed.` };
  const pct = score.realizedReturnPct === null ? '' : ` (${score.realizedReturnPct > 0 ? '+' : ''}${score.realizedReturnPct}% on the plan)`;
  switch (score.result) {
    case 'WIN': return { tone: 'good', text: `Win${pct}. ${score.note}` };
    case 'LOSS': return { tone: 'bad', text: `Loss${pct}. ${score.note}` };
    case 'REJECTION_CORRECT': return { tone: 'good', text: `Rejection was right: the declined plan would have been stopped out${pct}. ${score.note}` };
    case 'REJECTION_MISSED': return { tone: 'bad', text: `Rejection missed a winner: the declined plan would have hit its target${pct}. ${score.note}` };
    case 'FLAT': return { tone: 'muted', text: `Flat${pct}. ${score.note}` };
    default: return { tone: 'muted', text: `Not scorable. ${score.note}` };
  }
}

function RecordCard({ entry, defaultOpen }: { entry: PublicEntry; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const score = scoreLine(entry, entry.score);
  const rec = entry.recommendation;
  return (
    <article className={`record-card record-card--${entry.status === 'MISSED' ? 'missed' : entry.verdict === 'APPROVE' ? 'approve' : 'reject'}`}>
      <header className="record-card__head">
        <span>#{entry.seq} · {fmtTime(entry.ruledAt)}</span>
        <span>{entry.asset ?? '—'} · {entry.timeframe?.toUpperCase() ?? '—'} · {entry.riskLevel ?? '—'} risk</span>
      </header>
      <div className="record-card__verdict">
        <strong>{verdictLabel(entry)}</strong>
        {entry.tally ? <span>{voteLine(entry)}</span> : null}
      </div>
      {entry.status === 'MISSED' ? <p className="record-card__note">{entry.missedReason}</p> : <>
        {rec?.status === 'ACTIONABLE' ? <dl className="record-card__plan">
          <div><dt>Entry</dt><dd>{fmtPrice(rec.entryPrice)}</dd></div>
          <div><dt>Stop</dt><dd>{fmtPrice(rec.stopPrice)}</dd></div>
          <div><dt>Target</dt><dd>{fmtPrice(rec.targetPrice)}</dd></div>
          <div><dt>Reward / risk</dt><dd>{rec.rewardRisk ?? '—'}</dd></div>
        </dl> : null}
        {entry.betterLevel ? <p className="record-card__note">Optional: {entry.betterLevel.instruction}</p> : null}
        <p className={`record-card__outcome record-card__outcome--${score.tone}`}><b>Outcome</b> {score.text}</p>
        <button type="button" className="record-card__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide the judges' : 'Read the three judges'}</button>
        {open ? <ul className="record-card__judges">
          {entry.judges.map((judge) => <li key={judge.judgeId}>
            <div><b>{judge.lens}</b><span>{judge.vote ?? '—'}{judge.confidence !== null ? ` · ${judge.confidence}` : ''}{judge.reasonCode ? ` · ${judge.reasonCode}` : ''}</span></div>
            <p>{judge.rationale}</p>
          </li>)}
        </ul> : null}
        {entry.dataFreshness ? <p className="record-card__meta">{entry.dataFreshness}</p> : null}
      </>}
      <footer className="record-card__foot">
        <span>{entry.source === 'BACKFILL' ? 'Backfilled from an earlier acceptance run' : 'Scheduled run'} · {entry.model ?? 'no model'}{entry.doctrineVersion ? ` · doctrine ${entry.doctrineVersion}` : ''}</span>
        <span title={entry.hashes.reportDigest ?? ''}>report {shortHash(entry.hashes.reportDigest)} · entry {shortHash(entry.hashes.entryHash)}</span>
        <a href={`/api/cerebra/v1/public/ledger/${entry.seq}`} target="_blank" rel="noreferrer">Raw record</a>
      </footer>
    </article>
  );
}

export function TrackStats({ record, verification }: { record: PublicTrackRecord | null; verification: PublicVerification | null }) {
  if (!record) return null;
  const chainOk = verification ? verification.valid : record.chain.valid;
  return (
    <div className="record-stats" aria-label="Track record">
      <div><span>Rulings</span><strong>{record.rulings}</strong><small>{record.approved} approved · {record.rejected} rejected{record.missedSlots ? ` · ${record.missedSlots} missed` : ''}</small></div>
      <div><span>Advised trades scored</span><strong>{record.signals.scored ? `${record.signals.wins}W · ${record.signals.losses}L` : '—'}</strong><small>{record.signals.winRatePct !== null ? `${record.signals.winRatePct}% win rate` : 'none resolved yet'}{record.signals.averageReturnPct !== null ? ` · avg ${record.signals.averageReturnPct}%` : ''}</small></div>
      <div><span>Rejections scored</span><strong>{record.rejections.correct + record.rejections.missed ? `${record.rejections.correct} right · ${record.rejections.missed} missed` : '—'}</strong><small>{record.rejections.accuracyPct !== null ? `${record.rejections.accuracyPct}% right` : 'none resolved yet'}</small></div>
      <div className={chainOk ? 'is-ok' : 'is-bad'}><span>Record integrity</span><strong>{chainOk ? <><ShieldCheck /> Chain verified</> : <><TriangleAlert /> Chain broken</>}</strong><small>{record.chain.headHash ? `head ${shortHash(record.chain.headHash)}` : 'no entries yet'}</small></div>
    </div>
  );
}

export function PublicRecord({ limit, expandFirst, showStats }: { limit: number; expandFirst?: boolean; showStats?: boolean }) {
  const [entries, setEntries] = useState<PublicEntry[] | null>(null);
  const [record, setRecord] = useState<PublicTrackRecord | null>(null);
  const [verification, setVerification] = useState<PublicVerification | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    cerebraApi<{ entries: PublicEntry[] }>(`/v1/public/ledger?limit=${limit}`)
      .then((body) => { if (!cancelled) setEntries(body.entries); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'The public record could not be loaded.'); });
    if (showStats) {
      cerebraApi<PublicTrackRecord>('/v1/public/track-record').then((body) => { if (!cancelled) setRecord(body); }).catch(() => undefined);
      cerebraApi<PublicVerification>('/v1/public/ledger/verify').then((body) => { if (!cancelled) setVerification(body); }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [limit, showStats]);

  if (error) return <p className="record-empty" role="alert">{error}</p>;
  if (!entries) return <p className="record-empty" aria-live="polite">Loading the public record…</p>;
  return (
    <div className="record-list">
      {showStats ? <TrackStats record={record} verification={verification} /> : null}
      {entries.length === 0 ? <p className="record-empty">No rulings have been published yet.</p> : entries.map((entry, index) => <RecordCard key={entry.seq} entry={entry} defaultOpen={Boolean(expandFirst) && index === 0} />)}
    </div>
  );
}

export function RecordLink() {
  return <Link className="record-link" href="/record">Open the full record, track record and verification steps <ArrowRight /></Link>;
}
