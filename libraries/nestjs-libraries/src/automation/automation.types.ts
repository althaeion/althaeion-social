/**
 * The workflow vocabulary.
 *
 * Postiz already had `AutoPost`, which is one hard-wired path: read an RSS feed,
 * optionally have AI rewrite the item, publish it. Useful, but it is the only
 * shape it can ever be. This is the general form — a graph the operator draws,
 * where fetching a feed is one node among several rather than the premise.
 */

export type AutomationNodeType =
  | 'TRIGGER'
  | 'GENERATE'
  | 'DELAY'
  | 'CONDITION'
  | 'PUBLISH'
  | 'WEBHOOK'
  | 'END'
  | 'FETCH_RSS'
  | 'HTTP_REQUEST';

export type ConditionOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'matches'
  | 'greater_than'
  | 'less_than';

/** A condition node has two outputs; edges carry which branch they leave from. */
export type ConditionHandle = 'yes' | 'no';

export type DelayUnit = 'minutes' | 'hours' | 'days';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type AuthType = 'none' | 'bearer' | 'basic' | 'api_key';

export interface AutomationNode {
  id: string;
  type: AutomationNodeType;
  /** Free-form per type; validated by AutomationConfigValidator before saving. */
  config: Record<string, any>;
  /** Builder-only; the engine never reads these. */
  position?: { x: number; y: number };
  label?: string;
}

export interface AutomationEdge {
  id: string;
  source: string;
  target: string;
  /** Only set on edges leaving a CONDITION. */
  handle?: ConditionHandle;
}

export interface AutomationGraph {
  nodes: AutomationNode[];
  edges: AutomationEdge[];
}

/** What one node hands back to the engine. */
export interface NodeResult {
  output: Record<string, any>;
  /** Which branch to follow out of a CONDITION. */
  branch?: ConditionHandle;
  /** Stop this run here, successfully — an END node, or a filtered-out item. */
  halt?: boolean;
  /** Re-enter this node at a later time; used by DELAY. */
  resumeAt?: Date;
}

/**
 * Ceilings, so a mis-drawn graph cannot become a bill.
 *
 * MAX_STEPS is the one that matters: a cycle in the graph is easy to draw by
 * accident, and without a step budget a two-node loop runs until something else
 * breaks. It is a step count rather than a cycle check on purpose — a workflow
 * may legitimately revisit a node, it just may not do so forever.
 */
export const AUTOMATION_LIMITS = {
  MAX_STEPS: 50,
  MAX_NODES: 60,
  MAX_RSS_ITEMS_PER_RUN: 10,
  MAX_DELAY_DAYS: 30,
  HTTP_TIMEOUT_MS: 15000,
  MAX_CONCURRENT_RUNS_PER_AUTOMATION: 1,
};
