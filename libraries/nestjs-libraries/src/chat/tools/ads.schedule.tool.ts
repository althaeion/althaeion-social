import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';

@Injectable()
export class AdsScheduleTool implements AgentToolInterface {
  constructor(private _adsService: AdsService) {}
  name = 'adsScheduleTool';

  run() {
    return createTool({
      id: 'adsScheduleTool',
      mcp: {
        annotations: {
          title: 'Schedule Ad Variants',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Put chosen ad variants on the calendar, spaced out.
They are created as DRAFTS on purpose: an ad set exists to be chosen between, so a human approves before anything reaches an audience. Tell the user they are drafts and where to find them.
`,
      inputSchema: z.object({
        variantIds: z.array(z.string()).describe('Variant ids from adsGenerateTool'),
        integrationIds: z.array(z.string()).describe('Channel ids to draft them on'),
        startAt: z.string().optional().describe('When the first one lands (UTC). Defaults to an hour from now'),
        everyHours: z.number().optional().describe('Hours between each. Defaults to 24'),
      }),
      outputSchema: z.object({
        output: z.object({
          created: z.number(),
          postIds: z.array(z.string()),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const result = await this._adsService.scheduleVariants(
          organizationId,
          inputData.variantIds,
          inputData.integrationIds,
          inputData.startAt,
          inputData.everyHours
        );

        return { output: result };
      },
    });
  }
}
