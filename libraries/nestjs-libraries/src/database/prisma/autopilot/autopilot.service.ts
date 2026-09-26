import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AutopilotRepository } from '@gitroom/nestjs-libraries/database/prisma/autopilot/autopilot.repository';
import { AutopilotDto } from '@gitroom/nestjs-libraries/dtos/autopilot/autopilot.dto';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { BrandService } from '@gitroom/nestjs-libraries/database/prisma/brand/brand.service';
import { ContentEditorService } from '@gitroom/nestjs-libraries/openai/content.editor.service';
import { AiUsageService } from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai.usage.service';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

/**
 * Keeps a calendar full without being asked.
 *
 * Three properties make this something an operator can actually leave switched
 * on, and each is a deliberate limit rather than a feature:
 *
 *  1. It writes DRAFTS unless autoApprove is explicitly on. An agent that can
 *     publish unattended is a liability the day a prompt goes wrong in public.
 *  2. It fills only the gap. It counts what is ALREADY queued and tops up to the
 *     target, so a busy week costs nothing and a manual post is never duplicated.
 *  3. It stops at a weekly credit ceiling, checked from the usage log before it
 *     spends — the whole point of metering was to be able to enforce something.
 */
@Injectable()
export class AutopilotService {
  constructor(
    private _autopilotRepository: AutopilotRepository,
    private _postsService: PostsService,
    private _openaiService: OpenaiService,
    private _brandService: BrandService,
    private _contentEditorService: ContentEditorService,
    private _aiUsageService: AiUsageService,
    private _post: PrismaRepository<'post'>
  ) {}

  get(orgId: string) {
    return this._autopilotRepository.get(orgId);
  }

  save(orgId: string, body: AutopilotDto) {
    return this._autopilotRepository.save(orgId, body);
  }

  async setActive(orgId: string, active: boolean) {
    await this._autopilotRepository.save(orgId, (await this.get(orgId)) as any);
    return this._autopilotRepository.setActive(
      orgId,
      active,
      active ? dayjs().add(1, 'minute').toDate() : null
    );
  }

  runs(orgId: string) {
    return this.get(orgId).then((a) => (a ? this._autopilotRepository.runs(a.id) : []));
  }

  /** Scheduler tick: run every autopilot that is due. */
  async tick() {
    const due = await this._autopilotRepository.due(new Date());
    const results: { orgId: string; created: number }[] = [];

    for (const autopilot of due) {
      // Re-armed first, so a run that throws still has a next occurrence.
      await this._autopilotRepository.markRan(autopilot.id, dayjs().add(6, 'hour').toDate());

      try {
        const stats = await this.fill(autopilot);
        results.push({ orgId: autopilot.organizationId, created: stats.created });
      } catch (err) {
        await this._autopilotRepository.recordRun(autopilot.id, {
          planned: 0,
          created: 0,
          skipped: 0,
          creditsUsed: 0,
          error: (err as Error)?.message,
        });
      }
    }

    return results;
  }

  /** One pass for one organisation. Also reachable from a "run now" button. */
  async fill(autopilot: {
    id: string;
    organizationId: string;
    integrations: string;
    postsPerWeek: number;
    horizonDays: number;
    slots: string;
    topics: string;
    autoApprove: boolean;
    weeklyCreditCap: number;
  }) {
    const orgId = autopilot.organizationId;
    const integrations: string[] = this.readJson(autopilot.integrations, []);
    const topics: string[] = this.readJson(autopilot.topics, []);
    const slots: string[] = this.readJson(autopilot.slots, []);

    if (!integrations.length) {
      const stats = { planned: 0, created: 0, skipped: 0, creditsUsed: 0 };
      await this._autopilotRepository.recordRun(autopilot.id, {
        ...stats,
        error: 'No channels selected.',
      });
      return stats;
    }

    // The ceiling is checked BEFORE any spending, not after. A cap enforced
    // afterwards is an invoice, not a cap.
    if (autopilot.weeklyCreditCap > 0) {
      const spent = await this._aiUsageService.creditsThisWeek(orgId);
      if (spent >= autopilot.weeklyCreditCap) {
        const stats = { planned: 0, created: 0, skipped: 0, creditsUsed: 0 };
        await this._autopilotRepository.recordRun(autopilot.id, {
          ...stats,
          error: `Weekly credit cap reached (${spent}/${autopilot.weeklyCreditCap}).`,
        });
        return stats;
      }
    }

    const horizonEnd = dayjs().add(autopilot.horizonDays, 'day');
    const weeks = Math.max(1, autopilot.horizonDays / 7);
    const target = Math.ceil(autopilot.postsPerWeek * weeks);

    // Count everything already on the calendar in the window, whoever created
    // it — the autopilot tops up a schedule, it does not own one.
    const existing = await this._post.model.post.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
        state: { in: ['QUEUE', 'DRAFT'] },
        publishDate: { gte: new Date(), lte: horizonEnd.toDate() },
      },
    });

    const planned = Math.max(0, target - existing);
    if (!planned) {
      const stats = { planned: 0, created: 0, skipped: existing, creditsUsed: 0 };
      await this._autopilotRepository.recordRun(autopilot.id, stats);
      return stats;
    }

    // One pass never writes more than a handful, however big the gap: a first
    // run against an empty calendar would otherwise generate dozens of posts in
    // one go, which is both a bill and an unreviewable pile of drafts.
    const toCreate = Math.min(planned, 5);
    const brand = await this._brandService.prompt(orgId);

    let created = 0;
    let creditsUsed = 0;
    let cursor = this.firstSlotAfter(dayjs().add(4, 'hour'), slots);

    for (let i = 0; i < toCreate; i++) {
      const topic = topics.length ? topics[(existing + i) % topics.length] : null;

      const prompt =
        (brand ? `${brand}\n\n` : '') +
        `Write ONE social post${topic ? ` about: ${topic}` : ''}. ` +
        'One idea, said plainly. No preamble, no hashtag wall, no "in today\'s fast-paced world".';

      try {
        const generated = await this._openaiService.generatePosts(prompt);
        let content = Array.isArray(generated)
          ? generated[0]?.content ?? ''
          : String(generated ?? '');

        if (!content.trim()) {
          continue;
        }

        content = await this._contentEditorService.humanize(orgId, content);

        const group = makeId(10);
        await this._postsService.createPost(
          orgId,
          {
            // autoApprove is the only thing standing between this and posting to
            // a live audience with nobody watching. Default is off.
            type: autopilot.autoApprove ? 'schedule' : 'draft',
            date: cursor.toISOString(),
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
          'autopilot' as any
        );

        created++;
        cursor = this.firstSlotAfter(cursor.add(1, 'hour'), slots);
      } catch (err) {
        console.error('[autopilot] could not create a post', {
          orgId,
          error: (err as Error)?.message,
        });
      }
    }

    creditsUsed = await this._aiUsageService.creditsThisWeek(orgId);
    const stats = { planned, created, skipped: existing, creditsUsed };
    await this._autopilotRepository.recordRun(autopilot.id, stats);
    return stats;
  }

  /**
   * The next configured time-of-day at or after `from`. With no slots set it
   * spreads posts a day apart rather than stacking them in one afternoon.
   */
  private firstSlotAfter(from: dayjs.Dayjs, slots: string[]): dayjs.Dayjs {
    if (!slots.length) {
      return from.add(1, 'day');
    }

    const parsed = slots
      .map((slot) => {
        const [h, m] = String(slot).split(':').map(Number);
        return Number.isFinite(h) && Number.isFinite(m) ? { h, m } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a!.h * 60 + a!.m - (b!.h * 60 + b!.m)) as { h: number; m: number }[];

    if (!parsed.length) {
      return from.add(1, 'day');
    }

    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const day = from.add(dayOffset, 'day');
      for (const slot of parsed) {
        const candidate = day.hour(slot.h).minute(slot.m).second(0).millisecond(0);
        if (candidate.isAfter(from)) {
          return candidate;
        }
      }
    }

    return from.add(1, 'day');
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
