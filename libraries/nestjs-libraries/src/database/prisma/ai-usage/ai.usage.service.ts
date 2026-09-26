import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { AiUsageRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai.usage.repository';
import {
  AiUsageKind,
  creditsForUsage,
} from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai.credit.cost';

@Injectable()
export class AiUsageService {
  constructor(private _aiUsageRepository: AiUsageRepository) {}

  /**
   * Price a call and write the line. Returns the credits charged so a caller
   * that enforces a cap (the autopilot) can add it to its running total without
   * a second query.
   *
   * Recording is deliberately non-fatal: a metering write that fails must not
   * throw away a generation the user is already looking at. It is logged as a
   * miss instead, which is the honest trade — an under-count is recoverable,
   * losing the work is not.
   */
  async record(
    orgId: string,
    usage: {
      kind: AiUsageKind;
      provider?: string | null;
      model?: string | null;
      feature?: string | null;
      promptTokens?: number;
      completionTokens?: number;
      quantity?: number;
    }
  ): Promise<number> {
    const totalTokens = (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
    const credits = creditsForUsage({
      kind: usage.kind,
      model: usage.model,
      totalTokens,
      quantity: usage.quantity,
    });

    try {
      await this._aiUsageRepository.record(orgId, { ...usage, totalTokens, credits });
    } catch (err) {
      console.error('[ai-usage] could not record usage', {
        orgId,
        kind: usage.kind,
        model: usage.model,
        credits,
        error: (err as Error)?.message,
      });
    }

    return credits;
  }

  creditsThisWeek(orgId: string) {
    return this._aiUsageRepository.creditsSince(orgId, dayjs().startOf('week').toDate());
  }

  creditsThisMonth(orgId: string) {
    return this._aiUsageRepository.creditsSince(orgId, dayjs().startOf('month').toDate());
  }

  async usage(orgId: string, days = 30) {
    const since = dayjs().subtract(days, 'day').toDate();
    const [breakdown, recent, total] = await Promise.all([
      this._aiUsageRepository.breakdown(orgId, since),
      this._aiUsageRepository.recent(orgId),
      this._aiUsageRepository.creditsSince(orgId, since),
    ]);

    return {
      since,
      total,
      breakdown: breakdown.map((row) => ({
        kind: row.kind,
        feature: row.feature,
        calls: row._count._all,
        credits: row._sum.credits ?? 0,
        tokens: row._sum.totalTokens ?? 0,
      })),
      recent,
    };
  }
}
