import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AutopilotDto } from '@gitroom/nestjs-libraries/dtos/autopilot/autopilot.dto';

@Injectable()
export class AutopilotRepository {
  constructor(
    private _autopilot: PrismaRepository<'autopilot'>,
    private _autopilotRun: PrismaRepository<'autopilotRun'>
  ) {}

  get(orgId: string) {
    return this._autopilot.model.autopilot.findUnique({
      where: { organizationId: orgId },
    });
  }

  save(orgId: string, body: AutopilotDto) {
    const data = {
      integrations: JSON.stringify(body.integrations || []),
      postsPerWeek: body.postsPerWeek ?? 5,
      horizonDays: body.horizonDays ?? 14,
      slots: JSON.stringify(body.slots || []),
      topics: JSON.stringify(body.topics || []),
      autoApprove: body.autoApprove ?? false,
      weeklyCreditCap: body.weeklyCreditCap ?? 0,
    };

    return this._autopilot.model.autopilot.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...data },
      update: data,
    });
  }

  setActive(orgId: string, active: boolean, nextRunAt: Date | null) {
    return this._autopilot.model.autopilot.update({
      where: { organizationId: orgId },
      data: { active, nextRunAt },
    });
  }

  due(now: Date) {
    return this._autopilot.model.autopilot.findMany({
      where: { active: true, nextRunAt: { lte: now } },
      take: 100,
    });
  }

  markRan(id: string, nextRunAt: Date) {
    return this._autopilot.model.autopilot.update({
      where: { id },
      data: { lastRunAt: new Date(), nextRunAt },
    });
  }

  recordRun(
    autopilotId: string,
    stats: { planned: number; created: number; skipped: number; creditsUsed: number; error?: string }
  ) {
    return this._autopilotRun.model.autopilotRun.create({
      data: {
        autopilotId,
        planned: stats.planned,
        created: stats.created,
        skipped: stats.skipped,
        creditsUsed: stats.creditsUsed,
        error: stats.error ? stats.error.slice(0, 1000) : null,
      },
    });
  }

  runs(autopilotId: string, take = 20) {
    return this._autopilotRun.model.autopilotRun.findMany({
      where: { autopilotId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
