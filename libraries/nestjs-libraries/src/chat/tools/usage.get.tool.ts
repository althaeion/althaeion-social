import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AiUsageService } from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai.usage.service';

@Injectable()
export class UsageGetTool implements AgentToolInterface {
  constructor(private _aiUsageService: AiUsageService) {}
  name = 'usageGetTool';

  run() {
    return createTool({
      id: 'usageGetTool',
      mcp: {
        annotations: {
          title: 'Get AI Usage',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Report what AI has cost this workspace: total credits over a window, split by kind (text, image, video) and by feature, plus the most recent calls.
Answers "why did my credits drop?" with the actual lines rather than a guess.
Text is billed per 150 tokens; images are billed per image at a per-model rate.
`,
      inputSchema: z.object({
        days: z.number().optional().describe('Window in days. Defaults to 30'),
      }),
      outputSchema: z.object({
        output: z.object({
          total: z.number().describe('Credits spent in the window'),
          breakdown: z.array(z.any()),
          recent: z.array(z.any()),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const usage = await this._aiUsageService.usage(
          organizationId,
          Math.min(365, inputData.days || 30)
        );

        return {
          output: { total: usage.total, breakdown: usage.breakdown, recent: usage.recent },
        };
      },
    });
  }
}
