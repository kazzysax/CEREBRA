'use client';

import type { CSSProperties } from 'react';
import { ArrowDown, BrainCircuit, Check, CircleAlert, FileCheck, Fingerprint, Gavel, LoaderCircle, Radio, ShieldCheck, Swords } from 'lucide-react';
import type { CourtRunResult, JudgeOpinion, RunPhase } from '@/lib/cerebra';

export function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><img src="/cerebra-mark.png" alt="" /></span>;
}

function ConfidenceRing({ value }: { value: number | null }) {
  const percent = Math.round((value ?? 0) * 100);
  return <span className="confidence-ring" style={{ '--confidence': `${percent * 3.6}deg` } as CSSProperties}><span>{percent}</span></span>;
}

export function JudgeCard({ opinion }: { opinion: JudgeOpinion }) {
  const isDissent = opinion.opinionType === 'DISSENT';
  const Icon = opinion.lens === 'RISK' ? ShieldCheck : opinion.lens === 'EVIDENCE' ? Fingerprint : BrainCircuit;
  return (
    <article className={`judge-card ${isDissent ? 'is-dissent' : ''}`}>
      <div className="judge-card__top">
        <div className="judge-identity">
          <span className="judge-icon"><Icon /></span>
          <div><p>{opinion.lens.toLowerCase()} judge</p><span>{opinion.judgeId}</span></div>
        </div>
        <ConfidenceRing value={opinion.confidence} />
      </div>
      <div className="judge-verdict-row">
        <span className={`vote-pill vote-${opinion.vote?.toLowerCase()}`}>{opinion.vote ?? 'UNAVAILABLE'}</span>
        <span className="opinion-label">{opinion.opinionType.replace('_', ' ')}</span>
      </div>
      <p className="judge-rationale">{opinion.rationale}</p>
      <div className="judge-code"><span>Reason code</span><code>{opinion.reasonCode ?? 'NO_DECISION'}</code></div>
    </article>
  );
}

export type CourtSubStage = 'EVIDENCE' | 'CHALLENGER' | 'JUDGES';

const courtProgressSteps = [
  { key: 'evidence' as const, label: 'Analyst gathering intel', Icon: Radio },
  { key: 'challenger' as const, label: 'Challenger is questioning', Icon: Swords },
  { key: 'judges' as const, label: 'Case in court', Icon: Gavel },
  { key: 'report' as const, label: 'Report ready', Icon: FileCheck },
];

export function CourtProgress({
  phase,
  subStage,
  result,
}: {
  phase: RunPhase;
  subStage: CourtSubStage;
  result: CourtRunResult | null;
}) {
  const activeIndex = phase === 'COMPLETE'
    ? 3
    : subStage === 'EVIDENCE' ? 0 : subStage === 'CHALLENGER' ? 1 : 2;
  const tally = result?.report.tally;
  const dissentCount = result?.report.dissentingJudgeIds.length ?? 0;

  const descriptions: Record<(typeof courtProgressSteps)[number]['key'], string> = {
    evidence: 'Live Bitget market data is sealed and handed to the Analyst.',
    challenger: 'Stress-testing the thesis for weak assumptions and stale evidence.',
    judges: tally
      ? `${tally.approve} approve / ${tally.reject} reject${dissentCount ? ` — ${dissentCount} dissent recorded` : ' — unanimous decision'}`
      : 'Risk, Evidence and Strategy judges review the case independently.',
    report: phase === 'COMPLETE' ? 'Your Decision Kit is ready to read and download below.' : 'Compiling the ruling, ballots and full trace.',
  };

  return (
    <div className="court-progress" aria-label="Court proceeding progress">
      {courtProgressSteps.map((step, index) => {
        const isComplete = phase === 'COMPLETE' || index < activeIndex;
        const isActive = index === activeIndex && phase !== 'COMPLETE';
        return (
          <div className="court-progress__row" key={step.key}>
            <div className={`court-progress__step ${isComplete ? 'is-complete' : ''} ${isActive ? 'is-active' : ''}`}>
              <span className="court-progress__icon">{isActive ? <LoaderCircle className="animate-spin" /> : isComplete ? <Check /> : <step.Icon />}</span>
              <div className="court-progress__copy"><strong>{step.label}</strong><p>{descriptions[step.key]}</p></div>
            </div>
            {index < courtProgressSteps.length - 1 ? <div className="court-progress__arrow" aria-hidden="true"><ArrowDown /></div> : null}
          </div>
        );
      })}
    </div>
  );
}

export function Dissent({ opinions }: { opinions: JudgeOpinion[] }) {
  const dissent = opinions.find((judge) => judge.opinionType === 'DISSENT');
  return (
    <section className="dissent-block">
      <div className="dissent-mark"><CircleAlert /></div>
      <div className="dissent-copy">
        <p className="eyebrow">Dissent entered into record</p>
        <h3>{dissent ? `${dissent.judgeId} rejects the majority position.` : 'The panel reached a unanimous decision.'}</h3>
        <p>{dissent?.rationale ?? 'No dissenting opinion was filed for this ruling.'}</p>
      </div>
      <div className="dissent-meta"><span>Minority vote</span><strong>{dissent?.vote ?? 'NONE'}</strong><code>{dissent?.reasonCode ?? 'UNANIMOUS'}</code></div>
    </section>
  );
}
