import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { ContentEditorService } from '@gitroom/nestjs-libraries/openai/content.editor.service';

@Injectable()
export class ContentReviewTool implements AgentToolInterface {
  constructor(private _contentEditorService: ContentEditorService) {}
  name = 'contentReviewTool';

  run() {
    return createTool({
      id: 'contentReviewTool',
      mcp: {
        annotations: {
          title: 'Review Content',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Check a draft for grammar, spelling and clarity and return up to 8 targeted corrections.
Each suggestion carries the EXACT substring to replace, the replacement, and a one-line reason - so corrections can be applied one at a time instead of accepting a wholesale rewrite.
Does not touch facts, numbers, names, hashtags, URLs or mentions. An empty list means the text is fine.
`,
      inputSchema: z.object({
        content: z.string().describe('The text to review'),
      }),
      outputSchema: z.object({
        output: z.object({
          suggestions: z.array(
            z.object({
              original: z.string().describe('The exact substring to replace'),
              suggestion: z.string().describe('What to replace it with'),
              reason: z.string().describe('Why, in one line'),
            })
          ),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const suggestions = await this._contentEditorService.review(
          organizationId,
          inputData.content
        );

        return { output: { suggestions } };
      },
    });
  }
}
