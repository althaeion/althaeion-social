'use client';

import useSWR from 'swr';
import { useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import clsx from 'clsx';
import { AutomationBuilder } from '@gitroom/frontend/components/automations/automation.builder';

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'text-[#10b981]',
  PAUSED: 'text-[#f59e0b]',
  DRAFT: 'text-customColor18',
};

const RUN_COLOR: Record<string, string> = {
  COMPLETED: 'text-[#10b981]',
  FAILED: 'text-[#ef4444]',
  RUNNING: 'text-customColor18',
  PENDING: 'text-customColor18',
};

export const AutomationsComponent = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const load = useCallback(async (path: string) => (await (await fetch(path)).json()) ?? null, []);

  const { data: automations, isLoading, mutate } = useSWR('/automations', load, {
    revalidateOnFocus: false,
  });
  const { data: runs, mutate: mutateRuns } = useSWR(
    openId ? `/automations/${openId}/runs` : null,
    load
  );

  const act = async (id: string, action: 'activate' | 'pause' | 'run') => {
    setBusy(id + action);
    try {
      const response = await fetch(`/automations/${id}/${action}`, { method: 'POST' });
      if (!response.ok) {
        // The activate endpoint refuses an invalid graph and says why — showing
        // that reason is the whole point of validating at activation.
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || 'failed');
      }
      toaster.show(
        action === 'run' ? 'Workflow fired' : action === 'pause' ? 'Paused' : 'Active',
        'success'
      );
      mutate();
      mutateRuns();
    } catch (err: any) {
      toaster.show(err?.message || 'That did not work', 'warning');
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!newName.trim()) {
      return;
    }

    // A new workflow starts as a trigger wired to an end: a valid, inert graph
    // the builder can grow, rather than an empty object that fails validation
    // the first time anyone touches it.
    const body = {
      name: newName,
      triggerType: 'SCHEDULE',
      triggerConfig: { intervalMinutes: 1440 },
      nodes: [
        { id: 'trigger', type: 'TRIGGER', config: {}, label: 'Every day', position: { x: 0, y: 0 } },
        { id: 'end', type: 'END', config: {}, label: 'End', position: { x: 240, y: 0 } },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'end' }],
    };

    try {
      await fetch('/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setNewName('');
      toaster.show('Workflow created', 'success');
      mutate();
    } catch {
      toaster.show('Could not create the workflow', 'warning');
    }
  };

  if (isLoading) {
    return <LoadingComponent />;
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <h1 className="text-[24px]">Automations</h1>
      <div className="text-[14px] text-customColor18">
        Workflows that run on their own: a trigger, then steps that fetch a feed, call an API,
        branch on a condition, wait, generate copy in your brand voice, and publish. Every run is
        recorded step by step, so a failure reads like a stack trace instead of silence.
      </div>

      <div className="bg-sixth border border-customColor6 rounded-[4px] p-[16px] flex gap-[10px] items-end">
        <div className="flex-1">
          <Input
          disableForm={true}
            label="New workflow"
            name="newName"
            value={newName}
            onChange={(e: any) => setNewName(e.target.value)}
            placeholder="Daily digest to LinkedIn"
          />
        </div>
        <Button onClick={create}>Create</Button>
      </div>

      {!(automations || []).length ? (
        <div className="text-[14px] text-customColor18">No workflows yet.</div>
      ) : null}

      {(automations || []).map((automation: any) => (
        <div
          key={automation.id}
          className="bg-sixth border border-customColor6 rounded-[4px] p-[16px]"
        >
          <div className="flex items-center justify-between gap-[10px]">
            <div>
              <div className="text-[16px]">{automation.name}</div>
              <div className="text-[12px] text-customColor18">
                <span className={STATUS_COLOR[automation.status] || ''}>{automation.status}</span>
                {' · '}
                {automation.triggerType.replace(/_/g, ' ').toLowerCase()}
                {automation.nextRunAt
                  ? ` · next ${new Date(automation.nextRunAt).toLocaleString()}`
                  : ''}
              </div>
            </div>

            <div className="flex gap-[8px]">
              <Button
                secondary={true}
                disabled={busy === automation.id + 'run'}
                onClick={() => act(automation.id, 'run')}
              >
                Run now
              </Button>
              {automation.status === 'ACTIVE' ? (
                <Button
                  secondary={true}
                  disabled={busy === automation.id + 'pause'}
                  onClick={() => act(automation.id, 'pause')}
                >
                  Pause
                </Button>
              ) : (
                <Button
                  disabled={busy === automation.id + 'activate'}
                  onClick={() => act(automation.id, 'activate')}
                >
                  Activate
                </Button>
              )}
              <Button
                secondary={true}
                onClick={() => setEditId(editId === automation.id ? null : automation.id)}
              >
                {editId === automation.id ? 'Close' : 'Edit'}
              </Button>
              <Button
                secondary={true}
                onClick={() => setOpenId(openId === automation.id ? null : automation.id)}
              >
                {openId === automation.id ? 'Hide runs' : 'Runs'}
              </Button>
            </div>
          </div>

          {editId === automation.id ? (
            <AutomationBuilder
              automation={automation}
              onSaved={() => {
                mutate();
              }}
            />
          ) : null}

          {openId === automation.id ? (
            <div className="mt-[16px] flex flex-col gap-[8px]">
              {!(runs || []).length ? (
                <div className="text-[13px] text-customColor18">It has not run yet.</div>
              ) : null}

              {(runs || []).map((run: any) => (
                <div key={run.id} className="border border-customColor6 rounded-[4px] p-[10px]">
                  <div className="flex justify-between text-[12px]">
                    <span className={RUN_COLOR[run.status] || ''}>{run.status}</span>
                    <span className="text-customColor18">
                      {new Date(run.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {run.error ? (
                    <div className="text-[12px] text-[#ef4444] mt-[4px]">{run.error}</div>
                  ) : null}

                  <div className="mt-[6px] flex flex-col gap-[2px]">
                    {(run.nodeRuns || []).map((node: any) => (
                      <div
                        key={node.id}
                        className="flex items-center gap-[8px] text-[12px] text-customColor18"
                      >
                        <span
                          className={clsx(
                            'w-[6px] h-[6px] rounded-full',
                            node.status === 'COMPLETED'
                              ? 'bg-[#10b981]'
                              : node.status === 'FAILED'
                              ? 'bg-[#ef4444]'
                              : 'bg-customColor18'
                          )}
                        />
                        <span className="uppercase tracking-[0.1em]">{node.type}</span>
                        {node.error ? (
                          <span className="text-[#ef4444]">{node.error}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
};
