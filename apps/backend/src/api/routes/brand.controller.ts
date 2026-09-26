import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { BrandService } from '@gitroom/nestjs-libraries/database/prisma/brand/brand.service';
import {
  BrandAnalyzeDto,
  BrandProfileDto,
} from '@gitroom/nestjs-libraries/dtos/brand/brand.profile.dto';
import { ContentEditorService } from '@gitroom/nestjs-libraries/openai/content.editor.service';
import { AiUsageService } from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai.usage.service';
import { NotificationPreferenceService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.preference.service';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { User } from '@prisma/client';
import {
  BRAND_VOICE_GROUPS,
  SINGLE_SELECT_GROUPS,
} from '@gitroom/nestjs-libraries/database/prisma/brand/brand.voice';

@ApiTags('Brand')
@Controller('/brand')
export class BrandController {
  constructor(
    private _brandService: BrandService,
    private _contentEditorService: ContentEditorService,
    private _aiUsageService: AiUsageService,
    private _notificationPreferenceService: NotificationPreferenceService
  ) {}

  /**
   * Notification switches live per USER, not per organisation: one member
   * silencing connection warnings must not silence them for their colleagues.
   */
  @Get('/notifications')
  notificationPreferences(@GetUserFromRequest() user: User) {
    return this._notificationPreferenceService.get(user.id);
  }

  @Put('/notifications')
  saveNotificationPreferences(
    @GetUserFromRequest() user: User,
    @Body()
    body: {
      postPublished?: boolean;
      postFailed?: boolean;
      accountDisconnected?: boolean;
      mentionedInComment?: boolean;
    }
  ) {
    return this._notificationPreferenceService.save(user.id, body);
  }

  @Get('/')
  get(@GetOrgFromRequest() org: Organization) {
    return this._brandService.get(org.id);
  }

  /** The vocabulary, so the UI renders controls instead of a free-text box. */
  @Get('/voice-options')
  voiceOptions() {
    return { groups: BRAND_VOICE_GROUPS, singleSelect: SINGLE_SELECT_GROUPS };
  }

  @Put('/')
  save(@GetOrgFromRequest() org: Organization, @Body() body: BrandProfileDto) {
    return this._brandService.save(org.id, body);
  }

  @Post('/analyze')
  analyze(@GetOrgFromRequest() org: Organization, @Body() body: BrandAnalyzeDto) {
    return this._brandService.analyze(org.id, body.website);
  }

  @Post('/humanize')
  humanize(
    @GetOrgFromRequest() org: Organization,
    @Body() body: { content: string; platform?: string }
  ) {
    return this._contentEditorService
      .humanize(org.id, body.content, body.platform)
      .then((content) => ({ content }));
  }

  @Post('/review')
  review(@GetOrgFromRequest() org: Organization, @Body() body: { content: string }) {
    return this._contentEditorService
      .review(org.id, body.content)
      .then((suggestions) => ({ suggestions }));
  }

  @Get('/usage')
  usage(@GetOrgFromRequest() org: Organization, @Query('days') days?: string) {
    return this._aiUsageService.usage(org.id, Math.min(365, Number(days) || 30));
  }
}
