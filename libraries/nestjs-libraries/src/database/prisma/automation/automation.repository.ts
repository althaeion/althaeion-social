import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AutomationDto } from '@gitroom/nestjs-libraries/dtos/automation/automation.dto';

@Injectable()
export class AutomationRepository {
  constructor(
    private _automation: PrismaRepository<'automation'>,
    private _automationRun: PrismaRepository<'automationRun'>,
    private _automationNodeRun: PrismaRepository<'automationNodeRun'>,
    private _automationTriggerItem: PrismaRepository<'automationTriggerItem'>,
    private _automationNodeState: PrismaRepository<'automationNodeState'>
  ) {}

  getAutomations(orgId: string) {
    return this._automation.model.automation.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  getAutomation(orgId: string, id: string) {
    return this._automation.model.automation.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  /** Used by the engine, which already has the id and needs the org off the row. */
  getForRun(id: string) {
    return this._automation.model.automation.findFirst({
      where: { id, deletedAt: null },
    });
  }

  save(orgId: string, body: AutomationDto, id?: string) {
    const data = {
      name: body.name,
      description: body.description ?? null,
      triggerType: body.triggerType,
      triggerConfig: JSON.stringify(body.triggerConfig || {}),
      nodes: JSON.stringify(body.nodes || []),
      edges: JSON.stringify(body.edges || []),
    };

    if (id) {
      return this._automation.model.automation.update({
        where: { id, organizationId: orgId },
        data,
      });
    }

    return this._automation.model.automation.create({
      data: { organizationId: orgId, ...data },
    });
  }

  setStatus(orgId: string, id: string, status: 'DRAFT' | 'ACTIVE' | 'PAUSED', nextRunAt?: Date | null) {
    return this._automation.model.automation.update({
      where: { id, organizationId: orgId },
      data: { status, ...(nextRunAt !== undefined ? { nextRunAt } : {}) },
    });
  }

  deleteAutomation(orgId: string, id: string) {
    return this._automation.model.automation.update({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }

  /** Schedule-triggered workflows that are due. */
  dueSchedules(now: Date) {
    return this._automation.model.automation.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        triggerType: 'SCHEDULE',
        nextRunAt: { lte: now },
      },
      take: 100,
    });
  }

  /** Workflows listening for a post event. */
  listeningFor(orgId: string, triggerType: 'POST_PUBLISHED' | 'POST_SCHEDULED') {
    return this._automation.model.automation.findMany({
      where: { organizationId: orgId, deletedAt: null, status: 'ACTIVE', triggerType },
    });
  }

  markRan(id: string, nextRunAt: Date | null) {
    return this._automation.model.automation.update({
      where: { id },
      data: { lastRunAt: new Date(), nextRunAt },
    });
  }

  // ── runs ────────────────────────────────────────────────────────────────

  createRun(automationId: string, context: Record<string, any>) {
    return this._automationRun.model.automationRun.create({
      data: { automationId, context: JSON.stringify(context) },
    });
  }

  getRun(id: string) {
    return this._automationRun.model.automationRun.findUnique({ where: { id } });
  }

  markRunRunning(id: string) {
    return this._automationRun.model.automationRun.update({
      where: { id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
  }

  completeRun(id: string, context: Record<string, any>) {
    return this._automationRun.model.automationRun.update({
      where: { id },
      data: { status: 'COMPLETED', context: JSON.stringify(context), finishedAt: new Date() },
    });
  }

  failRun(id: string, error: string) {
    return this._automationRun.model.automationRun.update({
      where: { id },
      data: { status: 'FAILED', error: error.slice(0, 2000), finishedAt: new Date() },
    });
  }

  /** A run waiting out a DELAY: still PENDING, with the context it will resume from. */
  parkRun(id: string, context: Record<string, any>, resumeAt: Date) {
    return this._automationRun.model.automationRun.update({
      where: { id },
      data: { status: 'PENDING', context: JSON.stringify({ ...context, __resumeAt: resumeAt }) },
    });
  }

  runsFor(automationId: string, take = 20) {
    return this._automationRun.model.automationRun.findMany({
      where: { automationId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { nodeRuns: { orderBy: { createdAt: 'asc' } } },
    });
  }

  // ── node runs ───────────────────────────────────────────────────────────

  startNodeRun(runId: string, nodeId: string, type: any) {
    return this._automationNodeRun.model.automationNodeRun.create({
      data: { runId, nodeId, type, status: 'RUNNING', startedAt: new Date() },
    });
  }

  completeNodeRun(id: string, output: Record<string, any>) {
    return this._automationNodeRun.model.automationNodeRun.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        // Node output can be a whole HTTP body; cap it so one workflow cannot
        // fill the table with megabytes of somebody else's HTML.
        output: JSON.stringify(output).slice(0, 50000),
        finishedAt: new Date(),
      },
    });
  }

  failNodeRun(id: string, error: string) {
    return this._automationNodeRun.model.automationNodeRun.update({
      where: { id },
      data: { status: 'FAILED', error: error.slice(0, 2000), finishedAt: new Date() },
    });
  }

  // ── trigger dedupe ──────────────────────────────────────────────────────

  // ── per-node watermark ──────────────────────────────────────────────────

  /**
   * The state a node carries BETWEEN runs. Created empty on first access, so a
   * caller never has to distinguish "never polled" from "polled and found
   * nothing" at the storage layer.
   */
  async nodeState(automationId: string, nodeId: string): Promise<Record<string, any>> {
    const row = await this._automationNodeState.model.automationNodeState.findUnique({
      where: { automationId_nodeId: { automationId, nodeId } },
    });

    if (!row) {
      return {};
    }

    try {
      return JSON.parse(row.data || '{}');
    } catch {
      return {};
    }
  }

  /** Merge rather than replace: two keys (`last_item_date`, `seen_keys`) are written independently. */
  async saveNodeState(automationId: string, nodeId: string, patch: Record<string, any>) {
    const current = await this.nodeState(automationId, nodeId);
    const data = JSON.stringify({ ...current, ...patch });

    return this._automationNodeState.model.automationNodeState.upsert({
      where: { automationId_nodeId: { automationId, nodeId } },
      create: { automationId, nodeId, data },
      update: { data },
    });
  }

  /**
   * True the FIRST time this automation sees an external id, false after.
   * A unique constraint does the deciding, so two workers racing the same feed
   * cannot both win.
   */
  async claimTriggerItem(automationId: string, externalId: string): Promise<boolean> {
    try {
      await this._automationTriggerItem.model.automationTriggerItem.create({
        data: { automationId, externalId: externalId.slice(0, 500) },
      });
      return true;
    } catch {
      return false;
    }
  }
}
