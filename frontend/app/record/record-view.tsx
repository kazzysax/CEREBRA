'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PublicRecord } from '@/components/public-record';

const canonSnippet = [
  "const canon = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v)",
  "  : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'",
  "  : '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()",
  "      .map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';",
  "const { entry, report } = await (await fetch(BASE + '/v1/public/ledger/1')).json();",
  "const { createHash } = await import('node:crypto');",
  "const digest = 'sha256:' + createHash('sha256').update(canon(report)).digest('hex');",
  "console.log(digest === entry.hashes.reportDigest);",
].join('\n');

export function RecordView() {
  const [base, setBase] = useState('https://YOUR-CEREBRA-HOST/api/cerebra');
  useEffect(() => { setBase(window.location.origin + '/api/cerebra'); }, []);
  return (
    <div className="record-page">
      <div className="record-page__bar"><Link href="/">CEREBRA</Link><span>PUBLIC RECORD</span></div>
      <section className="record-section">
        <div className="record-section__inner">
          <span className="record-kicker">PUBLIC RECORD / VERIFIABLE</span>
          <h2>Every ruling.<br /><span>Checked against the market.</span></h2>
          <p className="record-section__lede">
            Three scheduled court runs a day are published here, hits and misses together. Each ruling is scored by code from Bitget candles after its horizon:
            the trade the court advised, or, when it rejected a plan, what that plan would have done. Rulings the court could not score are marked as such,
            and a slot that failed is shown as missed instead of being left out.
          </p>
          <PublicRecord limit={30} showStats />
          <div className="record-howto" id="verify">
            <h3>Check it yourself</h3>
            <ol>
              <li>Open any ruling&apos;s <b>Raw record</b>. It contains the full report as the judges produced it, including the evidence snapshot and its timestamps.</li>
              <li>Recompute the digest: canonical JSON (object keys sorted, no whitespace) hashed with SHA-256 must equal the entry&apos;s <code>reportDigest</code>.</li>
              <li>Each entry&apos;s hash also covers the previous entry&apos;s hash. <code>/v1/public/ledger/verify</code> re-checks the whole chain, and any edit or deletion of an older entry breaks it.</li>
              <li>The candles inside the evidence can be compared with Bitget&apos;s public candle history for the same symbol and time.</li>
            </ol>
            <pre>{canonSnippet.replace('BASE', JSON.stringify(base))}</pre>
            <p>
              What this proves and what it does not: the chain makes edits to published rulings detectable, and outcomes are computed from public market data by code, not entered by hand.
              We operate the server, so for the strongest guarantee keep a copy of the head hash today and compare it later. Past performance on a handful of rulings says nothing about future results,
              and nothing here is financial advice or an order.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
