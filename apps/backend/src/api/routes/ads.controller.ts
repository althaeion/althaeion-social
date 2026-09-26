import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';
import {
  AdCampaignDto,
  ScheduleVariantsDto,
} from '@gitroom/nestjs-libraries/dtos/ads/ad.campaign.dto';
import {
  AD_ANGLES,
  AD_OBJECTIVES,
  FUNNEL_STAGES,
} from '@gitroom/nestjs-libraries/database/prisma/ads/ads.generator';
import { AutopilotService } from '@gitroom/nestjs-libraries/database/prisma/autopilot/autopilot.service';
import { AutopilotDto } from '@gitroom/nestjs-libraries/dtos/autopilot/autopilot.dto';

@ApiTags('Ads')
@Controller('/ads')
export class AdsController {
  constructor(
    private _adsService: AdsService,
    private _autopilotService: AutopilotService
  ) {}

  /** The angle and stage vocabulary, so the brief form is built from one source. */
  @Get('/options')
  options() {
    return { angles: AD_ANGLES, stages: FUNNEL_STAGES, objectives: AD_OBJECTIVES };
  }

  @Get('/')
  campaigns(@GetOrgFromRequest() org: Organization) {
    return this._adsService.getCampaigns(org.id);
  }

  @Get('/:id')
  campaign(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._adsService.getCampaign(org.id, id);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  create(@GetOrgFromRequest() org: Organization, @Body() body: AdCampaignDto) {
    return this._adsService.create(org.id, body);
  }

  @Post('/:id/regenerate')
  regenerate(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._adsService.regenerate(org.id, id);
  }

  @Post('/variants/:variantId/toggle')
  toggle(
    @GetOrgFromRequest() org: Organization,
    @Param('variantId') variantId: string,
    @Body() body: { selected: boolean }
  ) {
    return this._adsService.toggleVariant(org.id, variantId, !!body.selected);
  }

  @Post('/schedule')
  schedule(@GetOrgFromRequest() org: Organization, @Body() body: ScheduleVariantsDto) {
    return this._adsService.scheduleVariants(
      org.id,
      body.variantIds,
      body.integrationIds,
      body.startAt,
      body.everyHours
    );
  }

  @Delete('/:id')
  remove(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._adsService.deleteCampaign(org.id, id);
  }

  // ── autopilot ─────────────────────────────────────────────────────────────

  @Get('/autopilot/settings')
  autopilot(@GetOrgFromRequest() org: Organization) {
    return this._autopilotService.get(org.id);
  }

  @Post('/autopilot/settings')
  saveAutopilot(@GetOrgFromRequest() org: Organization, @Body() body: AutopilotDto) {
    return this._autopilotService.save(org.id, body);
  }

  @Post('/autopilot/active')
  setAutopilotActive(
    @GetOrgFromRequest() org: Organization,
    @Body() body: { active: boolean }
  ) {
    return this._autopilotService.setActive(org.id, !!body.active);
  }

  @Get('/autopilot/runs')
  autopilotRuns(@GetOrgFromRequest() org: Organization) {
    return this._autopilotService.runs(org.id);
  }
}
