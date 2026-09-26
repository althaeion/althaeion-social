import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AutomationRepository } from '@gitroom/nestjs-libraries/database/prisma/automation/automation.repository';
import { AutomationNodeRunner } from '@gitroom/nestjs-libraries/automation/automation.node.runner';
import { ExpressionResolver } from '@gitroom/nestjs-libraries/automation/expression.resolver';
import {
  AUTOMATION_LIMITS,
  AutomationEdge,
  AutomationGraph,
  AutomationNode,
  NodeResult,
} from '@gitroom/nestjs-libraries/automation/automation.types';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

/**
 * Walks a workflow graph.
 *
 * Everything a node produces is written into the run's `context` under its own
 * id, so a later step addresses it as `{{ <nodeId>.content }}`. The context is
 * persisted after every node: a worker that dies mid-run leaves a readable
 * record of exactly how far it got, instead of a workflow that simply never
 * finished.
 */
@Injectable()
export class AutomationEngine {
  constructor(
    private _automationRepository: AutomationRepository,
    private _automationNodeRunner: AutomationNodeRunner,
    private _expressionResolver: ExpressionResolver,
    private _postsService: PostsService
  ) {}

  /**
   * Run a workflow to completion, a halt, or a delay.
   *
   * `seed` is what the trigger observed — the RSS item, the published post —
   * and lands in the context as `trigger`.
   */
  async run(automationId: string, seed: Record<string, any> = {}, existingRunId?: string) {
    const automation = await this._automationRepository.getForRun(automationId);
    if (!automation) {
      return { status: 'MISSING' as const };
    }

    const graph = this.readGraph(automation.nodes, automation.edges);
    const trigger = graph.nodes.find((n) => n.type === 'TRIGGER');
    if (!trigger) {
      return { status: 'MISSING' as const };
    }

    const run = existingRunId
      ? await this._automationRepository.getRun(existingRunId)
      : await this._automationRepository.createRun(automationId, { trigger: seed });

    if (!run) {
      return { status: 'MISSING' as const };
    }

    let context: Record<string, any> = this.readJson(run.context, { trigger: seed });
    await this._automationRepository.markRunRunning(run.id);

    // Resuming from a DELAY re-enters at the node after it, not at the trigger.
    let currentId: string | undefined = existingRunId
      ? this.readJson<Record<string, any>>(run.context, {}).__resumeNodeId ||
        this.next(graph, trigger.id)
      : this.next(graph, trigger.id);

    let steps = 0;

    while (currentId) {
      if (++steps > AUTOMATION_LIMITS.MAX_STEPS) {
        // A cycle is easy to draw by accident. Failing loudly at the ceiling is
        // the only way the author ever learns the graph loops.
        await this._automationRepository.failRun(
          run.id,
          `This workflow ran more than ${AUTOMATION_LIMITS.MAX_STEPS} steps and was stopped. It probably loops.`
        );
        return { status: 'FAILED' as const };
      }

      const node = graph.nodes.find((n) => n.id === currentId);
      if (!node) {
        break;
      }

      const nodeRun = await this._automationRepository.startNodeRun(run.id, node.id, node.type);

      try {
        const result =
          node.type === 'PUBLISH'
            ? await this.publish(automation.organizationId, node, context)
            : await this._automationNodeRunner.run(
                automation.organizationId,
                node,
                context,
                automation.id
              );

        context = { ...context, [node.id]: result.output };
        await this._automationRepository.completeNodeRun(nodeRun.id, result.output);

        if (result.resumeAt) {
          // Park the run. The scheduler picks it back up; the worker is not held
          // open for a delay that may be days long.
          const resumeNodeId = this.next(graph, node.id);
          await this._automationRepository.parkRun(run.id, {
            ...context,
            __resumeNodeId: resumeNodeId,
          }, result.resumeAt);
          return { status: 'DELAYED' as const, resumeAt: result.resumeAt };
        }

        if (result.halt) {
          await this._automationRepository.completeRun(run.id, context);
          return { status: 'COMPLETED' as const, context };
        }

        currentId = this.next(graph, node.id, result.branch);
      } catch (err) {
        const message = (err as Error)?.message || 'This step failed.';
        await this._automationRepository.failNodeRun(nodeRun.id, message);
        await this._automationRepository.failRun(run.id, `${node.label || node.type}: ${message}`);
        return { status: 'FAILED' as const, error: message };
      }
    }

    await this._automationRepository.completeRun(run.id, context);
    return { status: 'COMPLETED' as const, context };
  }

  /**
   * The PUBLISH node. Lives on the engine rather than the node runner because
   * it needs the organisation and the posts service, and because a node runner
   * able to publish is one that can publish from a dry run.
   */
  private async publish(
    orgId: string,
    node: AutomationNode,
    context: Record<string, any>
  ): Promise<NodeResult> {
    const config = node.config || {};
    const content = this._expressionResolver.resolve(String(config.content ?? ''), context);

    if (!content.trim()) {
      // Publishing an empty post is never what was meant, and platforms reject
      // it anyway — usually with an opaque error hours later.
      throw new Error('There was nothing to publish: the content resolved to empty.');
    }

    const integrations: string[] = Array.isArray(config.integrations) ? config.integrations : [];
    const when = config.when === 'now' ? 'now' : 'schedule';
    const date =
      config.when === 'now'
        ? dayjs().toISOString()
        : dayjs()
            .add(Number(config.delayMinutes || 0), 'minute')
            .toISOString();

    const group = makeId(10);

    const created = await this._postsService.createPost(
      orgId,
      {
        type: config.asDraft ? 'draft' : when,
        date,
        order: '',
        shortLink: false,
        tags: [],
        posts: integrations.map((id) => ({
          group,
          integration: { id },
          value: [{ content, id: undefined as any, delay: 0, image: [] }],
          settings: {} as any,
        })),
      } as any,
      'automation' as any
    );

    return {
      output: {
        published: true,
        draft: !!config.asDraft,
        integrations,
        postIds: (created || []).map((p: any) => p?.id).filter(Boolean),
      },
    };
  }

  /**
   * The next node id. A CONDITION picks the edge matching its branch; anything
   * else takes its first outgoing edge.
   */
  private next(
    graph: AutomationGraph,
    fromId: string,
    branch?: 'yes' | 'no'
  ): string | undefined {
    const outgoing = graph.edges.filter((e: AutomationEdge) => e.source === fromId);
    if (!outgoing.length) {
      return undefined;
    }

    if (branch) {
      // A condition whose branch has no edge ENDS the run rather than falling
      // through to the other branch — "no path for no" means "stop", and doing
      // the opposite would publish on exactly the runs the author filtered out.
      return outgoing.find((e) => e.handle === branch)?.target;
    }

    return outgoing[0].target;
  }

  private readGraph(nodes: string, edges: string): AutomationGraph {
    return {
      nodes: this.readJson<AutomationNode[]>(nodes, []),
      edges: this.readJson<AutomationEdge[]>(edges, []),
    };
  }

  private readJson<T>(value: string | null, fallback: T): T {
    try {
      const parsed = JSON.parse(value || '');
      return (parsed ?? fallback) as T;
    } catch {
      return fallback;
    }
  }
}
