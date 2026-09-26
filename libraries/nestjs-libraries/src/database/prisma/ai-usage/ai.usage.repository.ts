import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AiUsageKind } from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai.credit.cost';

@Injectable()
export class AiUsageRepository {
  constructor(private _aiUsageLog: PrismaRepository<'aiUsageLog'>) {}

  record(
    orgId: string,
    data: {
      kind: AiUsageKind;
      provider?: string | null;
      model?: string | null;
      feature?: string | null;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      quantity?: number;
      credits: number;
    }
  ) {
    return this._aiUsageLog.model.aiUsageLog.create({
      data: {
        organizationId: orgId,
        kind: data.kind,
        provider: data.provider ?? null,
        model: data.model ?? null,
        feature: data.feature ?? null,
        promptTokens: data.promptTokens ?? 0,
        completionTokens: data.completionTokens ?? 0,
        totalTokens: data.totalTokens ?? 0,
        quantity: data.quantity ?? 1,
        credits: data.credits,
      },
    });
  }

  /** Credits spent since a moment — backs both the usage screen and the autopilot cap. */
  async creditsSince(orgId: string, since: Date): Promise<number> {
    const { _sum } = await this._aiUsageLog.model.aiUsageLog.aggregate({
      _sum: { credits: true },
      where: { organizationId: orgId, createdAt: { gte: since } },
    });

    return _sum.credits ?? 0;
  }

  /** Spend split by kind and feature, so an unexpected drain can be explained. */
  breakdown(orgId: string, since: Date) {
    return this._aiUsageLog.model.aiUsageLog.groupBy({
      by: ['kind', 'feature'],
      where: { organizationId: orgId, createdAt: { gte: since } },
      _sum: { credits: true, totalTokens: true },
      _count: { _all: true },
    });
  }

  recent(orgId: string, take = 50) {
    return this._aiUsageLog.model.aiUsageLog.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
