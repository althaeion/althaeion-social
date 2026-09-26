import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { BrandService } from '@gitroom/nestjs-libraries/database/prisma/brand/brand.service';

@Injectable()
export class BrandGetTool implements AgentToolInterface {
  constructor(private _brandService: BrandService) {}
  name = 'brandGetTool';

  run() {
    return createTool({
      id: 'brandGetTool',
      mcp: {
        annotations: {
          title: 'Get Brand Profile',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Read the organization's brand profile: name, what it does, audience, tone, voice traits, language, colours, the words it uses and the words it avoids.
Call this BEFORE writing any post, caption or ad, and write to what it says - it is the difference between copy that sounds like the brand and copy that sounds like a model.
Returns null when no brand profile has been set up yet; in that case write plainly and do not invent a voice.
`,
      inputSchema: z.object({}),
      outputSchema: z.object({
        output: z.object({
          brand: z.any().describe('The brand profile, or null if none is set'),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        return { output: { brand: await this._brandService.context(organizationId) } };
      },
    });
  }
}
