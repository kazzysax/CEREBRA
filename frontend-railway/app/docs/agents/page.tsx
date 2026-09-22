import type { Metadata } from 'next';
import { AgentDocs } from './agent-docs';

export const metadata: Metadata = {
  title: 'Agent connection documentation — Cerebra',
  description: 'Connect trading agents to Cerebra through the Decision Kit HTTP API, MCP, or the built-in browser tool.',
  openGraph: {
    title: 'Connect an agent to Cerebra',
    description: 'Decision Kit API, MCP and browser-agent integration documentation.',
    images: [],
  },
  twitter: {
    card: 'summary',
    title: 'Connect an agent to Cerebra',
    description: 'Decision Kit API, MCP and browser-agent integration documentation.',
    images: [],
  },
};

export default function AgentDocsPage() {
  return <AgentDocs />;
}
