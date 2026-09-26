import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { ContentEditorService } from '@gitroom/nestjs-libraries/openai/content.editor.service';

@Injectable()
export class ContentHumanizeTool implements AgentToolInterface {
  constructor(private _contentEditorService: ContentEditorService) {}
  name = 'contentHumanizeTool';

  run() {
    return createTool({
      id: 'contentHumanizeTool',
      mcp: {
        annotations: {
          title: 'Humanize Content',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Rewrite a draft to strip the patterns that make copy read as AI-written: em dashes, "delve", "testament to", "it's not just X it's Y", forced rules of three, empty -ing verbs, generic upbeat conclusions.
Applies the brand voice and respects the target platform's character limit.
Run this on anything you wrote before scheduling it. It returns the rewritten text; if the rewrite fails or would break the platform limit, it returns the original unchanged rather than something that will not publish.
`,
      inputSchema: z.object({
        content: z.string().describe('The draft to rewrite'),
        platform: z
          .string()
          .optional()
          .describe('Target platform key (x, linkedin, instagram...), so the length cap is right'),
      }),
      outputSchema: z.object({
        output: z.object({ content: z.string() }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const content = await this._contentEditorService.humanize(
          organizationId,
          inputData.content,
          inputData.platform
        );

        return { output: { content } };
      },
    });
  }
}
