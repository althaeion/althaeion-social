import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { AutomationService } from '@gitroom/nestjs-libraries/database/prisma/automation/automation.service';
import { AutomationDto } from '@gitroom/nestjs-libraries/dtos/automation/automation.dto';

@ApiTags('Automation')
@Controller('/automations')
export class AutomationController {
  constructor(private _automationService: AutomationService) {}

  @Get('/')
  getAutomations(@GetOrgFromRequest() org: Organization) {
    return this._automationService.getAutomations(org.id);
  }

  @Get('/:id')
  getAutomation(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._automationService.getAutomation(org.id, id);
  }

  @Get('/:id/runs')
  runs(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._automationService.runs(org.id, id);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.WEBHOOKS])
  create(@GetOrgFromRequest() org: Organization, @Body() body: AutomationDto) {
    return this._automationService.save(org.id, body);
  }

  @Put('/:id')
  update(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: AutomationDto
  ) {
    return this._automationService.save(org.id, body, id);
  }

  @Post('/:id/activate')
  activate(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._automationService.activate(org.id, id);
  }

  @Post('/:id/pause')
  pause(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._automationService.pause(org.id, id);
  }

  /** The builder's test button: fires once without touching the schedule. */
  @Post('/:id/run')
  runNow(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._automationService.runNow(org.id, id);
  }

  @Delete('/:id')
  remove(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._automationService.delete(org.id, id);
  }
}
