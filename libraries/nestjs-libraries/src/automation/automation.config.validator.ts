import { Injectable } from '@nestjs/common';
import {
  AUTOMATION_LIMITS,
  AutomationGraph,
  AutomationNode,
  ConditionOperator,
} from '@gitroom/nestjs-libraries/automation/automation.types';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

const OPERATORS: ConditionOperator[] = [
  'contains',
  'not_contains',
  'equals',
  'not_equals',
  'matches',
  'greater_than',
  'less_than',
];

/**
 * Validates a graph at SAVE time.
 *
 * Catching a bad workflow here rather than at run time matters more than usual:
 * an automation runs unattended, often at 3am, and the person who drew it is not
 * watching. A graph that only reveals its problem on the first fire is a graph
 * that fails silently.
 */
@Injectable()
export class AutomationConfigValidator {
  async validate(graph: AutomationGraph): Promise<string[]> {
    const errors: string[] = [];
    const { nodes, edges } = graph;

    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return ['The workflow could not be read.'];
    }

    if (nodes.length > AUTOMATION_LIMITS.MAX_NODES) {
      errors.push(`A workflow can hold at most ${AUTOMATION_LIMITS.MAX_NODES} steps.`);
    }

    const triggers = nodes.filter((n) => n.type === 'TRIGGER');
    if (triggers.length !== 1) {
      errors.push('A workflow needs exactly one trigger.');
    }

    const ids = new Set<string>();
    for (const node of nodes) {
      if (!node.id) {
        errors.push('A step is missing its id.');
        continue;
      }
      if (ids.has(node.id)) {
        errors.push(`Two steps share the id "${node.id}".`);
      }
      ids.add(node.id);
    }

    for (const edge of edges) {
      if (!ids.has(edge.source) || !ids.has(edge.target)) {
        errors.push('An connection points at a step that does not exist.');
      }
    }

    // A step with no way in never runs. It is almost always a half-finished
    // edit rather than an intention, and silently skipping it is how a workflow
    // "works" while doing half of what its author sees on screen.
    const reachable = this.reachableFrom(triggers[0]?.id, edges);
    for (const node of nodes) {
      if (node.type !== 'TRIGGER' && !reachable.has(node.id)) {
        errors.push(`"${node.label || node.type}" is not connected to the trigger.`);
      }
    }

    for (const node of nodes) {
      errors.push(...(await this.validateNode(node)));
    }

    return errors;
  }

  private async validateNode(node: AutomationNode): Promise<string[]> {
    const errors: string[] = [];
    const config = node.config || {};
    const where = node.label || node.type;

    switch (node.type) {
      case 'GENERATE':
        if (!String(config.prompt || '').trim()) {
          errors.push(`"${where}" needs a prompt.`);
        }
        break;

      case 'DELAY': {
        const amount = Number(config.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          errors.push(`"${where}" needs a positive delay.`);
        }
        if (!['minutes', 'hours', 'days'].includes(config.unit)) {
          errors.push(`"${where}" has an unknown delay unit.`);
        }
        const days =
          config.unit === 'days'
            ? amount
            : config.unit === 'hours'
            ? amount / 24
            : amount / 1440;
        if (days > AUTOMATION_LIMITS.MAX_DELAY_DAYS) {
          errors.push(`"${where}" waits longer than ${AUTOMATION_LIMITS.MAX_DELAY_DAYS} days.`);
        }
        break;
      }

      case 'CONDITION':
        if (!String(config.left || '').trim()) {
          errors.push(`"${where}" needs something to compare.`);
        }
        if (!OPERATORS.includes(config.operator)) {
          errors.push(`"${where}" has an unknown comparison.`);
        }
        if (config.operator === 'matches') {
          // An invalid pattern would throw mid-run, at the point where the
          // author is least able to see it.
          try {
            new RegExp(String(config.right ?? ''));
          } catch {
            errors.push(`"${where}" has a pattern that is not valid.`);
          }
        }
        break;

      case 'PUBLISH':
        if (!Array.isArray(config.integrations) || !config.integrations.length) {
          errors.push(`"${where}" needs at least one channel to post to.`);
        }
        break;

      case 'WEBHOOK':
      case 'HTTP_REQUEST': {
        const url = String(config.url || '');
        if (!url) {
          errors.push(`"${where}" needs a URL.`);
          break;
        }
        // The same check the webhook DTO applies. The engine re-checks at call
        // time as well, because DNS can change between saving and running.
        if (!(await isSafePublicHttpsUrl(url))) {
          errors.push(`"${where}" points at an address that cannot be called.`);
        }
        if (
          node.type === 'HTTP_REQUEST' &&
          !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(config.method)
        ) {
          errors.push(`"${where}" has an unknown HTTP method.`);
        }
        if (config.auth && !['none', 'bearer', 'basic', 'api_key'].includes(config.auth.type)) {
          errors.push(`"${where}" has an unknown authentication type.`);
        }
        break;
      }

      case 'FETCH_RSS': {
        const url = String(config.url || '');
        if (!url) {
          errors.push(`"${where}" needs a feed URL.`);
          break;
        }
        if (!(await isSafePublicHttpsUrl(url))) {
          errors.push(`"${where}" points at a feed that cannot be read.`);
        }
        break;
      }

      case 'TRIGGER':
      case 'END':
        break;

      default:
        errors.push(`"${where}" is a step type this version does not know.`);
    }

    return errors;
  }

  private reachableFrom(startId: string | undefined, edges: AutomationGraph['edges']): Set<string> {
    const seen = new Set<string>();
    if (!startId) {
      return seen;
    }

    const queue = [startId];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of edges) {
        if (edge.source === current && !seen.has(edge.target)) {
          seen.add(edge.target);
          queue.push(edge.target);
        }
      }
    }

    return seen;
  }
}
