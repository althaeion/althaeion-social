import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { NotificationPreferenceService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.preference.service';

/**
 * Warns BEFORE a scheduled post fails, not after.
 *
 * Postiz already notices a dead channel — but at publish time, which is the
 * worst moment: the slot is gone, and whoever scheduled it finds out from a
 * failure notification hours later. This looks ahead at what is about to go
 * out, checks those channels, and warns while there is still time to reconnect.
 *
 * Every constant here exists to stop the warning itself becoming the problem.
 */
@Injectable()
export class ConnectionVerifier {
  /** How far ahead to look. Long enough to act on, short enough to be about today. */
  private static readonly VERIFY_LEAD_MINUTES = 30;

  /**
   * Skip a channel checked this recently. Without it, a post an hour out is
   * re-verified on every tick — four provider calls for one post, and provider
   * rate limits are the thing that disconnects channels in the first place.
   */
  private static readonly VERIFIED_WITHIN_MINUTES = 40;

  /** One warning per channel per hour, however many posts enter the window. */
  private static readonly RENOTIFY_COOLDOWN_MINUTES = 60;

  /**
   * A channel disconnected seconds ago is usually mid-reconnect: the operator is
   * in the OAuth flow right now. Warning them about what they are already fixing
   * trains people to ignore the warnings.
   */
  private static readonly RECENTLY_DISCONNECTED_GRACE_MINUTES = 5;

  private readonly lastWarned = new Map<string, number>();
  private readonly lastVerified = new Map<string, number>();

  constructor(
    private _integration: PrismaRepository<'integration'>,
    private _post: PrismaRepository<'post'>,
    private _integrationService: IntegrationService,
    private _notificationService: NotificationService,
    private _notificationPreferenceService: NotificationPreferenceService
  ) {}

  /**
   * One pass. Returns what it warned about so a caller (or a test) can assert
   * on it rather than reading logs.
   */
  async verifyUpcoming() {
    const now = dayjs();
    const horizon = now.add(ConnectionVerifier.VERIFY_LEAD_MINUTES, 'minute');

    const upcoming = await this._post.model.post.findMany({
      where: {
        deletedAt: null,
        state: { in: ['QUEUE', 'DRAFT'] },
        publishDate: { gte: now.toDate(), lte: horizon.toDate() },
      },
      select: { id: true, organizationId: true, integrationId: true, publishDate: true },
      take: 500,
    });

    if (!upcoming.length) {
      return { checked: 0, warned: [] as string[] };
    }

    // One warning per channel, not per post: five posts queued to one dead
    // channel is one problem, and five notifications about it is noise.
    const byIntegration = new Map<string, { orgId: string; posts: number; soonest: Date }>();
    for (const post of upcoming) {
      if (!post.integrationId) continue;
      const entry = byIntegration.get(post.integrationId);
      if (entry) {
        entry.posts += 1;
        if (post.publishDate < entry.soonest) entry.soonest = post.publishDate;
      } else {
        byIntegration.set(post.integrationId, {
          orgId: post.organizationId,
          posts: 1,
          soonest: post.publishDate,
        });
      }
    }

    const warned: string[] = [];

    for (const [integrationId, info] of byIntegration) {
      if (this.recentlyDone(this.lastVerified, integrationId, ConnectionVerifier.VERIFIED_WITHIN_MINUTES)) {
        continue;
      }
      this.lastVerified.set(integrationId, Date.now());

      const integration = await this._integration.model.integration.findFirst({
        where: { id: integrationId, deletedAt: null },
      });

      // A channel deleted between the post query and this read is not a
      // connection problem; the posts go with it.
      if (!integration) {
        continue;
      }

      const problem = this.problemWith(integration);
      if (!problem) {
        continue;
      }

      if (
        integration.updatedAt &&
        dayjs().diff(dayjs(integration.updatedAt), 'minute') <
          ConnectionVerifier.RECENTLY_DISCONNECTED_GRACE_MINUTES
      ) {
        continue;
      }

      if (this.recentlyDone(this.lastWarned, integrationId, ConnectionVerifier.RENOTIFY_COOLDOWN_MINUTES)) {
        continue;
      }
      this.lastWarned.set(integrationId, Date.now());

      await this.warn(info.orgId, integration.name, problem, info.posts, info.soonest);
      warned.push(integrationId);
    }

    return { checked: byIntegration.size, warned };
  }

  /** Why this channel will fail, phrased for the person who has to fix it. */
  private problemWith(integration: {
    disabled: boolean;
    refreshNeeded: boolean;
    inBetweenSteps: boolean;
    tokenExpiration: Date | null;
  }): string | null {
    if (integration.disabled) {
      return 'the channel is switched off';
    }
    if (integration.refreshNeeded) {
      return 'the connection expired and needs to be reconnected';
    }
    if (integration.inBetweenSteps) {
      return 'the connection was never finished';
    }
    if (integration.tokenExpiration && dayjs(integration.tokenExpiration).isBefore(dayjs())) {
      return 'the access token has expired';
    }
    return null;
  }

  private async warn(
    orgId: string,
    channel: string,
    problem: string,
    posts: number,
    soonest: Date
  ) {
    const when = dayjs(soonest).format('HH:mm');
    const subject = `${channel} will not publish`;
    const message =
      `${posts === 1 ? 'A post is' : `${posts} posts are`} scheduled on ${channel}, ` +
      `the first at ${when}, but ${problem}. ` +
      `Reconnect the channel and ${posts === 1 ? 'it' : 'they'} will go out as planned.`;

    try {
      // Nobody in this workspace wants connection warnings: send nothing rather
      // than mailing people who explicitly switched them off.
      const recipients = await this._notificationPreferenceService.recipients(
        orgId,
        'accountDisconnected'
      );

      if (!recipients.length) {
        return;
      }

      await this._notificationService.inAppNotification(orgId, subject, message, true);
    } catch (err) {
      // A warning that cannot be delivered must not take down the sweep for the
      // channels after it in the loop.
      console.error('[connection-verifier] could not deliver the warning', {
        orgId,
        channel,
        error: (err as Error)?.message,
      });
    }
  }

  private recentlyDone(store: Map<string, number>, key: string, minutes: number): boolean {
    const at = store.get(key);
    if (!at) {
      return false;
    }
    if (Date.now() - at > minutes * 60_000) {
      store.delete(key);
      return false;
    }
    return true;
  }
}
