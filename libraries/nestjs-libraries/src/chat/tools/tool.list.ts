import { IntegrationValidationTool } from '@gitroom/nestjs-libraries/chat/tools/integration.validation.tool';
import { IntegrationTriggerTool } from '@gitroom/nestjs-libraries/chat/tools/integration.trigger.tool';
import { IntegrationSchedulePostTool } from './integration.schedule.post';
import { GenerateVideoOptionsTool } from '@gitroom/nestjs-libraries/chat/tools/generate.video.options.tool';
import { VideoFunctionTool } from '@gitroom/nestjs-libraries/chat/tools/video.function.tool';
import { GenerateVideoTool } from '@gitroom/nestjs-libraries/chat/tools/generate.video.tool';
import { GenerateImageTool } from '@gitroom/nestjs-libraries/chat/tools/generate.image.tool';
import { IntegrationListTool } from '@gitroom/nestjs-libraries/chat/tools/integration.list.tool';
import { GroupListTool } from '@gitroom/nestjs-libraries/chat/tools/group.list.tool';
import { UploadFromUrlTool } from '@gitroom/nestjs-libraries/chat/tools/upload.from.url.tool';

import { BrandGetTool } from '@gitroom/nestjs-libraries/chat/tools/brand.get.tool';
import { ContentHumanizeTool } from '@gitroom/nestjs-libraries/chat/tools/content.humanize.tool';
import { ContentReviewTool } from '@gitroom/nestjs-libraries/chat/tools/content.review.tool';
import { AdsGenerateTool } from '@gitroom/nestjs-libraries/chat/tools/ads.generate.tool';
import { AdsScheduleTool } from '@gitroom/nestjs-libraries/chat/tools/ads.schedule.tool';
import { AutomationListTool } from '@gitroom/nestjs-libraries/chat/tools/automation.list.tool';
import { AutomationRunTool } from '@gitroom/nestjs-libraries/chat/tools/automation.run.tool';
import { UsageGetTool } from '@gitroom/nestjs-libraries/chat/tools/usage.get.tool';

export const toolList = [
  IntegrationListTool,
  GroupListTool,
  IntegrationValidationTool,
  IntegrationTriggerTool,
  IntegrationSchedulePostTool,
  GenerateVideoOptionsTool,
  VideoFunctionTool,
  GenerateVideoTool,
  GenerateImageTool,
  UploadFromUrlTool,
  BrandGetTool,
  ContentHumanizeTool,
  ContentReviewTool,
  AdsGenerateTool,
  AdsScheduleTool,
  AutomationListTool,
  AutomationRunTool,
  UsageGetTool,
];
