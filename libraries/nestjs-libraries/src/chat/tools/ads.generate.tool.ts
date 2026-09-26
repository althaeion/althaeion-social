import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AdsService } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.service';
import {
  AD_ANGLES,
  AD_OBJECTIVES,
  FUNNEL_STAGES,
} from '@gitroom/nestjs-libraries/database/prisma/ads/ads.generator';

@Injectable()
export class AdsGenerateTool implements AgentToolInterface {
  constructor(private _adsService: AdsService) {}
  name = 'adsGenerateTool';

  run() {
    return createTool({
      id: 'adsGenerateTool',
      mcp: {
        annotations: {
          title: 'Generate Ad Campaign',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Generate a set of ad variants from a brief, written to the brand voice.
The set is a matrix: each variant takes a named ANGLE (${Object.keys(AD_ANGLES).join(', ')}) at a funnel STAGE (${Object.keys(
        FUNNEL_STAGES
      ).join(', ')}), so the variants argue differently instead of rewording one idea - which is what makes a test tell you something.
Objectives: ${AD_OBJECTIVES.join(', ')}.
Variants are scored 0-100 against the brief and returned best first. They are NOT scheduled; use adsScheduleTool to put chosen ones on the calendar as drafts.
`,
      inputSchema: z.object({
        name: z.string().describe('Campaign name'),
        objective: z.enum(AD_OBJECTIVES as unknown as [string, ...string[]]),
        platforms: z
          .array(z.string())
          .describe('Platform keys to write for, e.g. ["linkedin","x"]'),
        product: z.string().optional().describe('What is being sold'),
        audience: z.string().optional().describe('Who it is for'),
        offer: z.string().optional().describe('The specific offer, discount or hook'),
        angles: z.array(z.string()).optional().describe('Restrict to these angles'),
        stages: z.array(z.string()).optional().describe('Restrict to these funnel stages'),
      }),
      outputSchema: z.object({
        output: z.object({
          campaignId: z.string(),
          variants: z.array(z.any()),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const campaign = await this._adsService.create(organizationId, inputData as any);

        return {
          output: { campaignId: campaign?.id || '', variants: (campaign as any)?.variants || [] },
        };
      },
    });
  }
}
