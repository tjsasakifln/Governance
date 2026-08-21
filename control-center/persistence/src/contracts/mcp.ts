import type { CurrentDirective, AttentionItem, SourceObservation } from '../types.js';

/**
 * Contract for the future MCP server. Agents query by scope and must never
 * receive the whole-company memory in one call.
 */
export type AgentContextQuery = {
  scope: string;
  asOf?: Date;
  limit?: number;
};

export type AgentContext = {
  scope: string;
  directives: CurrentDirective[];
  attention: AttentionItem[];
  latestObservations: SourceObservation[];
};

export type AgentContextPort = {
  loadContext(query: AgentContextQuery): Promise<AgentContext>;
};
