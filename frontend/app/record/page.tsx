import type { Metadata } from 'next';
import { RecordView } from './record-view';

export const metadata: Metadata = {
  title: 'Public record — Cerebra',
  description: 'Every court ruling Cerebra has published, how each fared against the market, and how to verify the record yourself.',
  openGraph: { title: 'Cerebra public record', description: 'Published court rulings, scored against the market, hash-chained so edits are detectable.', images: [] },
  twitter: { card: 'summary', title: 'Cerebra public record', description: 'Published court rulings, scored against the market, hash-chained so edits are detectable.', images: [] },
};

export default function RecordPage() {
  return <RecordView />;
}
