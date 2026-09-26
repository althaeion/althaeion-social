import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

/** The four things the app will notify about, and can now be told not to. */
export type NotificationKind =
  | 'postPublished'
  | 'postFailed'
  | 'accountDisconnected'
  | 'mentionedInComment';

@Injectable()
export class NotificationPreferenceService {
  constructor(
    private _notificationPreference: PrismaRepository<'notificationPreference'>,
    private _userOrganization: PrismaRepository<'userOrganization'>
  ) {}

  async get(userId: string) {
    const row = await this._notificationPreference.model.notificationPreference.findUnique({
      where: { userId },
    });

    // A user who never opened the setting has no row, and that must read as
    // "everything on" rather than "everything off".
    return (
      row ?? {
        userId,
        postPublished: true,
        postFailed: true,
        accountDisconnected: true,
        mentionedInComment: true,
      }
    );
  }

  save(userId: string, prefs: Partial<Record<NotificationKind, boolean>>) {
    const data = {
      postPublished: prefs.postPublished ?? true,
      postFailed: prefs.postFailed ?? true,
      accountDisconnected: prefs.accountDisconnected ?? true,
      mentionedInComment: prefs.mentionedInComment ?? true,
    };

    return this._notificationPreference.model.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  async wants(userId: string, kind: NotificationKind): Promise<boolean> {
    const prefs = await this.get(userId);
    return (prefs as any)[kind] !== false;
  }

  /**
   * The users in an organisation who still want a given kind of notification.
   *
   * Returning the filtered list rather than a yes/no for the org is deliberate:
   * one member silencing connection warnings must not silence them for their
   * colleagues.
   */
  async recipients(orgId: string, kind: NotificationKind): Promise<string[]> {
    const members = await this._userOrganization.model.userOrganization.findMany({
      where: { organizationId: orgId },
      select: { userId: true },
    });

    const wanted = await Promise.all(
      members.map(async (m) => ((await this.wants(m.userId, kind)) ? m.userId : null))
    );

    return wanted.filter((id): id is string => !!id);
  }
}
