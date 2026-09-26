'use client';

import useSWR from 'swr';
import { useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import clsx from 'clsx';

const list = (value?: string | null): string[] => {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

export const AutopilotComponent = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, any> | null>(null);

  const load = useCallback(async (path: string) => (await (await fetch(path)).json()) ?? null, []);

  const { data: settings, isLoading, mutate } = useSWR('/ads/autopilot/settings', load, {
    revalidateOnFocus: false,
  });
  const { data: runs } = useSWR('/ads/autopilot/runs', load, { revalidateOnFocus: false });
  const { data: integrations } = useSWR('/integrations/list', load, {
    revalidateOnFocus: false,
  });

  const state = useMemo(
    () =>
      form ?? {
        integrations: list(settings?.integrations),
        postsPerWeek: settings?.postsPerWeek ?? 5,
        horizonDays: settings?.horizonDays ?? 14,
        slots: list(settings?.slots),
        topics: list(settings?.topics),
        autoApprove: settings?.autoApprove ?? false,
        weeklyCreditCap: settings?.weeklyCreditCap ?? 0,
      },
    [form, settings]
  );

  const set = (key: string, value: any) => setForm({ ...state, [key]: value });

  const save = async () => {
    setSaving(true);
    try {
      await fetch('/ads/autopilot/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      toaster.show('Autopilot settings saved', 'success');
      setForm(null);
      mutate();
    } catch {
      toaster.show('Could not save', 'warning');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    try {
      await fetch('/ads/autopilot/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !settings?.active }),
      });
      mutate();
    } catch {
      toaster.show('Could not switch the autopilot', 'warning');
    }
  };

  if (isLoading) {
    return <LoadingComponent />;
  }

  const channels = integrations?.integrations || [];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex items-center gap-[12px]">
        <h1 className="text-[24px]">Autopilot</h1>
        <span
          className={clsx(
            'px-[10px] py-[3px] rounded-full text-[12px]',
            settings?.active ? 'bg-[#10b981] text-white' : 'bg-customColor6 text-customColor18'
          )}
        >
          {settings?.active ? 'on' : 'off'}
        </span>
      </div>

      <div className="text-[14px] text-customColor18">
        Keeps the calendar filled without being asked. It counts what is already queued and only
        tops up the gap, so a busy week costs nothing. It writes <strong>drafts</strong> unless you
        turn that off, and it stops at a credit ceiling you set.
      </div>

      <div className="bg-sixth border border-customColor6 rounded-[4px] p-[24px] flex flex-col gap-[16px]">
        <div className="flex flex-col gap-[8px]">
          <div className="text-[12px] uppercase tracking-[0.14em] text-customColor18">
            Channels to fill
          </div>
          <div className="flex flex-wrap gap-[8px]">
            {channels.map((integration: any) => {
              const active = state.integrations.includes(integration.id);
              return (
                <button
                  key={integration.id}
                  type="button"
                  onClick={() =>
                    set(
                      'integrations',
                      active
                        ? state.integrations.filter((i: string) => i !== integration.id)
                        : [...state.integrations, integration.id]
                    )
                  }
                  className={clsx(
                    'px-[12px] py-[6px] rounded-full text-[13px] border transition-colors',
                    active
                      ? 'bg-forth border-forth text-white'
                      : 'border-customColor6 text-customColor18'
                  )}
                >
                  {integration.name}
                </button>
              );
            })}
            {!channels.length ? (
              <div className="text-[13px] text-customColor18">Connect a channel first.</div>
            ) : null}
          </div>
        </div>

        <Input
          disableForm={true}
          label="Posts per week"
          name="postsPerWeek"
          type="number"
          value={String(state.postsPerWeek)}
          onChange={(e: any) => set('postsPerWeek', Number(e.target.value))}
        />

        <Input
          disableForm={true}
          label="Fill this many days ahead"
          name="horizonDays"
          type="number"
          value={String(state.horizonDays)}
          onChange={(e: any) => set('horizonDays', Number(e.target.value))}
        />

        <Input
          disableForm={true}
          label="Time slots (comma separated, e.g. 09:30, 17:00)"
          name="slots"
          value={state.slots.join(', ')}
          onChange={(e: any) =>
            set('slots', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))
          }
        />

        <Input
          disableForm={true}
          label="Topics it rotates through (comma separated)"
          name="topics"
          value={state.topics.join(', ')}
          onChange={(e: any) =>
            set('topics', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))
          }
        />

        <Input
          disableForm={true}
          label="Weekly credit ceiling (0 = no ceiling)"
          name="weeklyCreditCap"
          type="number"
          value={String(state.weeklyCreditCap)}
          onChange={(e: any) => set('weeklyCreditCap', Number(e.target.value))}
        />

        <label className="flex items-center gap-[10px] cursor-pointer">
          <input
            type="checkbox"
            checked={!!state.autoApprove}
            onChange={(e) => set('autoApprove', e.target.checked)}
          />
          <span className="text-[14px]">
            Publish without review
            <span className="text-customColor18">
              {' '}
              — off by default. With this on, posts go out unattended.
            </span>
          </span>
        </label>

        <div className="flex gap-[10px]">
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button secondary={true} onClick={toggleActive}>
            {settings?.active ? 'Switch off' : 'Switch on'}
          </Button>
        </div>
      </div>

      <div className="bg-sixth border border-customColor6 rounded-[4px] p-[24px]">
        <div className="text-[18px] mb-[10px]">Recent passes</div>
        {!(runs || []).length ? (
          <div className="text-[13px] text-customColor18">It has not run yet.</div>
        ) : null}
        <div className="flex flex-col gap-[6px]">
          {(runs || []).map((run: any) => (
            <div key={run.id} className="flex justify-between text-[13px]">
              <span className="text-customColor18">
                {new Date(run.createdAt).toLocaleString()}
              </span>
              <span>
                {run.created} created · {run.skipped} already queued
                {run.error ? ` · ${run.error}` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
