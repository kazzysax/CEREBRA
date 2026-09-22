import type { Metadata } from 'next';
import { AgentPortal } from './agent-portal';

export const metadata: Metadata = {
  title: 'Agent Identity & Memory — Cerebra',
  description: 'Register or connect a Cerebra agent, manage its key, and inspect durable strategy memory and recovery checkpoints.',
  openGraph: { title: 'Agent Identity & Memory — Cerebra', description: 'The control surface for Cerebra agent identity and durable market memory.', images: [] },
  twitter: { title: 'Agent Identity & Memory — Cerebra', description: 'The control surface for Cerebra agent identity and durable market memory.', images: [] },
};

export default function AgentPortalPage() {
  return <AgentPortal />;
}
