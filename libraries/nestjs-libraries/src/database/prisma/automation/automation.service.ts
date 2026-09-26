import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import dayjs from 'dayjs';
import { AutomationRepository } from '@gitroom/nestjs-libraries/database/prisma/automation/automation.repository';
import { AutomationConfigValidator } from '@gitroom/nestjs-libraries/automation/automation.config.validator';
import { AutomationEngine } from '@gitroom/nestjs-libraries/automation/automation.engine';
import { AutomationDto } from '@gitroom/nestjs-libraries/dtos/automation/automation.dto';
import { AutomationGraph } from '@gitroom/nestjs-libraries/automation/automation.types';

@Injectable()
export class AutomationService {
  constructor(
    private _automationRepository: AutomationRepository,
    private _automationConfigValidator: AutomationConfigValidator,
    private _automationEngine: AutomationEngine
  ) {}

  getAutomations(orgId: string) {
    return this._automationRepository.getAutomations(orgId);
  }

  getAutomation(orgId: string, id: string) {
    return this._automationRepository.getAutomation(orgId, id);
  }

  runs(orgId: string, id: string) {
    return this._automationRepository.runsFor(id);
  }

  /**
   * Saving validates but does not refuse. A half-drawn workflow is a normal
   * state to leave the builder in; what must not happen is a half-drawn
   * workflow going ACTIVE, and that is where the errors are enforced.
   */
  async save(orgId: string, body: AutomationDto, id?: string) {
    const errors = await this._automationConfigValidator.validate({
      nodes: body.nodes,
      edges: body.edges,
    } as AutomationGraph);

    const saved = await this._automationRepository.save(orgId, body, id);
    return { ...saved, errors };
  }

  async activate(orgId: string, id: string) {
    const automation = await this._automationRepository.getAutomation(orgId, id);
    if (!automation) {
      throw new NotFoundException('That workflow could not be found.');
    }

    const errors = await this._automationConfigValidator.validate({
      nodes: JSON.parse(automation.nodes || '[]'),
      edges: JSON.parse(automation.edges || '[]'),
    });

    if (errors.length) {
      // A bare Error would surface as a 500 "Internal server error" and throw
      // away the reasons — which are the only useful part of refusing.
      throw new BadRequestException({
        message: `This workflow cannot run yet: ${errors.join(' ')}`,
        errors,
      });
    }

    const nextRunAt =
      automation.triggerType === 'SCHEDULE'
        ? this.nextScheduleAt(JSON.parse(automation.triggerConfig || '{}'))
        : null;

    return this._automationRepository.setStatus(orgId, id, 'ACTIVE', nextRunAt);
  }

  pause(orgId: string, id: string) {
    return this._automationRepository.setStatus(orgId, id, 'PAUSED', null);
  }

  delete(orgId: string, id: string) {
    return this._automationRepository.deleteAutomation(orgId, id);
  }

  /** Fire once by hand, from the builder's "test" button. */
  runNow(orgId: string, id: string, seed: Record<string, any> = {}) {
    return this._automationEngine.run(id, { ...seed, manual: true });
  }

  /**
   * The scheduler tick. Each due workflow is re-armed BEFORE it runs, so a
   * workflow that throws still has a next occurrence — otherwise one failure
   * silently retires it forever.
   */
  async tick() {
    const due = await this._automationRepository.dueSchedules(new Date());
    const results: { id: string; status: string }[] = [];

    for (const automation of due) {
      const config = JSON.parse(automation.triggerConfig || '{}');
      await this._automationRepository.markRan(automation.id, this.nextScheduleAt(config));

      try {
        const result = await this._automationEngine.run(automation.id, {
          firedAt: dayjs().toISOString(),
        });
        results.push({ id: automation.id, status: result.status });
      } catch (err) {
        results.push({ id: automation.id, status: 'FAILED' });
        console.error('[automation] scheduled run failed', {
          id: automation.id,
          error: (err as Error)?.message,
        });
      }
    }

    return results;
  }

  /**
   * Post-event triggers. Called after a post publishes or is scheduled.
   * Dedupe is per automation, so two workflows may both react to one post but
   * neither reacts to it twice.
   */
  async onPostEvent(
    orgId: string,
    triggerType: 'POST_PUBLISHED' | 'POST_SCHEDULED',
    post: { id: string; content?: string; integration?: string }
  ) {
    const listeners = await this._automationRepository.listeningFor(orgId, triggerType);

    for (const automation of listeners) {
      const claimed = await this._automationRepository.claimTriggerItem(automation.id, post.id);
      if (!claimed) {
        continue;
      }

      try {
        await this._automationEngine.run(automation.id, { post });
      } catch (err) {
        console.error('[automation] event run failed', {
          id: automation.id,
          error: (err as Error)?.message,
        });
      }
    }
  }

  /**
   * When a SCHEDULE workflow should next fire.
   *
   * `intervalMinutes` is floored at 5: a workflow that fires every minute and
   * publishes is a way to get an account rate-limited, and nobody sets it on
   * purpose.
   */
  private nextScheduleAt(config: Record<string, any>): Date {
    if (config.cron === false && config.at) {
      const at = dayjs(config.at);
      return at.isAfter(dayjs()) ? at.toDate() : dayjs().add(1, 'day').toDate();
    }

    const interval = Math.max(5, Number(config.intervalMinutes || 60));
    return dayjs().add(interval, 'minute').toDate();
  }
}
