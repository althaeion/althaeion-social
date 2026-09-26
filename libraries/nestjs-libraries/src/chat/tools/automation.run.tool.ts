import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AutomationService } from '@gitroom/nestjs-libraries/database/prisma/automation/automation.service';

@Injectable()
export class AutomationRunTool implements AgentToolInterface {
  constructor(private _automationService: AutomationService) {}
  name = 'automationRunTool';

  run() {
    return createTool({
      id: 'automationRunTool',
      mcp: {
        annotations: {
          title: 'Run Automation Now',
          readOnlyHint: false,
          // A workflow can contain a PUBLISH step, so firing one can put
          // something in front of an audience. Flagged so a client that asks
          // before destructive calls actually asks.
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `
Fire a workflow once, right now, outside its schedule.
IMPORTANT: a workflow may contain a publish step, so this can create or publish posts. Confirm with the user before calling it, and say which workflow you are about to run.
Returns the run status: COMPLETED, FAILED, DELAYED (it hit a wait step and will resume later), or MISSING.
`,
      inputSchema: z.object({
        automationId: z.string().describe('Workflow id from automationListTool'),
      }),
      outputSchema: z.object({
        output: z.object({
          status: z.string(),
          error: z.string().optional(),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        // Read through the org-scoped getter first: without it any workflow id
        // could be fired by whoever guessed it.
        const automation = await this._automationService.getAutomation(
          organizationId,
          inputData.automationId
        );

        if (!automation) {
          return { output: { status: 'MISSING', error: 'No such workflow in this workspace.' } };
        }

        const result = await this._automationService.runNow(organizationId, automation.id);

        return { output: { status: result.status, error: (result as any).error } };
      },
    });
  }
}
