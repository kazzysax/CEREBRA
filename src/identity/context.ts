import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentIdentity } from "./contracts.js";

const agentContext = new AsyncLocalStorage<AgentIdentity | null>();

export function withAgentIdentity<T>(agent: AgentIdentity | null, operation: () => T): T {
  return agentContext.run(agent, operation);
}

export function currentAgentIdentity(): AgentIdentity | null {
  return agentContext.getStore() ?? null;
}
