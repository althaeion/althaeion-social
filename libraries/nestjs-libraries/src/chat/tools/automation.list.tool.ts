import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AutomationService } from '@gitroom/nestjs-libraries/database/prisma/automation/automation.service';

@Injectable()
export class AutomationListTool implements AgentToolInterface {
  constructor(private _automationService: AutomationService) {}
  name = 'automationListTool';

  run() {
    return createTool({
      id: 'automationListTool',
      mcp: {
        annotations: {
          title: 'List Automations',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
List the organization's workflows with their status (DRAFT, ACTIVE, PAUSED), what triggers them, when they last ran and when they run next.
Use this to answer "is anything posting automatically?" and to find the id of a workflow before running it.
Workflows are built in the workflow builder; these tools can list, run and pause them, but not draw them.
`,
      inputSchema: z.object({}),
      outputSchema: z.object({
        output: z.object({
          automations: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              status: z.string(),
              triggerType: z.string(),
              lastRunAt: z.string().nullable(),
              nextRunAt: z.string().nullable(),
            })
          ),
        }),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const automations = await this._automationService.getAutomations(organizationId);

        return {
          output: {
            automations: (automations || []).map((a: any) => ({
              id: a.id,
              name: a.name,
              status: a.status,
              triggerType: a.triggerType,
              lastRunAt: a.lastRunAt ? new Date(a.lastRunAt).toISOString() : null,
              nextRunAt: a.nextRunAt ? new Date(a.nextRunAt).toISOString() : null,
            })),
          },
        };
      },
    });
  }
}
