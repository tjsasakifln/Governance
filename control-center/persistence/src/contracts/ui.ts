import type { AttentionItem, CurrentDirective } from '../types.js';

/**
 * Contract for the future cockpit UI. Homepage should consume exceptions /
 * attention items rather than a KPI wall.
 */
export type CockpitQuery = {
  scope: string;
  attentionLimit?: number;
};

export type CockpitSnapshot = {
  scope: string;
  now: Date;
  importantNow: AttentionItem[];
  activeDirectives: CurrentDirective[];
};

export type CockpitPort = {
  loadHome(query: CockpitQuery): Promise<CockpitSnapshot>;
};
