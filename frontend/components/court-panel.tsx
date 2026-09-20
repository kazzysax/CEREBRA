'use client';

import type { CSSProperties } from 'react';
import { BrainCircuit, Check, CircleAlert, Fingerprint, LoaderCircle, Radio, ShieldCheck, Sparkles, Swords } from 'lucide-react';
import type { JudgeOpinion, RunPhase } from '@/lib/cerebra';

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

export function Pipeline({ phase }: { phase: RunPhase }) {
  const activeIndex = phase === 'COLLECTING' ? 0 : phase === 'ANALYSING' ? 3 : phase === 'COMPLETE' ? 5 : -1;
  const stages = [
    ['Bitget', Radio], ['Analyst', Sparkles], ['Challenge', Swords],
    ['Risk', ShieldCheck], ['Evidence', Fingerprint], ['Strategy', BrainCircuit],
  ] as const;
  return (
    <div className="pipeline" aria-label="Court pipeline">
      {stages.map(([label, Icon], index) => {
        const complete = phase === 'COMPLETE' || index < activeIndex;
        const active = index === activeIndex;
        return (
          <div className={`pipeline-step ${complete ? 'is-complete' : ''} ${active ? 'is-active' : ''}`} key={label}>
            <span>{active ? <LoaderCircle className="animate-spin" /> : complete ? <Check /> : <Icon />}</span>
            <small>{label}</small>
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
