'use client';

import { useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { Textarea } from '@gitroom/react/form/textarea';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';

/**
 * The workflow editor.
 *
 * Deliberately a step list rather than a drag-and-drop canvas. A canvas needs a
 * graph library the repo does not carry, and for the shape these workflows
 * actually take — a chain with the occasional branch — a list is easier to read
 * and far easier to get right. It emits exactly the `nodes` / `edges` JSON the
 * engine walks, so a canvas can replace it later without touching the backend.
 */

type NodeType =
  | 'TRIGGER'
  | 'FETCH_RSS'
  | 'HTTP_REQUEST'
  | 'CONDITION'
  | 'GENERATE'
  | 'DELAY'
  | 'PUBLISH'
  | 'WEBHOOK'
  | 'END';

const STEP_LABELS: Record<NodeType, string> = {
  TRIGGER: 'Trigger',
  FETCH_RSS: 'Read a feed',
  HTTP_REQUEST: 'Call an API',
  CONDITION: 'Only if',
  GENERATE: 'Write with AI',
  DELAY: 'Wait',
  PUBLISH: 'Publish',
  WEBHOOK: 'Send a webhook',
  END: 'End',
};

const ADDABLE: NodeType[] = [
  'FETCH_RSS',
  'HTTP_REQUEST',
  'CONDITION',
  'GENERATE',
  'DELAY',
  'PUBLISH',
  'WEBHOOK',
];

interface Node {
  id: string;
  type: NodeType;
  label?: string;
  config: Record<string, any>;
  position?: { x: number; y: number };
}

interface Edge {
  id: string;
  source: string;
  target: string;
  handle?: 'yes' | 'no';
}

const rid = () => Math.random().toString(36).slice(2, 9);

export const AutomationBuilder = ({
  automation,
  onSaved,
}: {
  automation: any;
  onSaved: () => void;
}) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (path: string) => (await (await fetch(path)).json()) ?? null, []);
  const { data: integrationList } = useSWR('/integrations/list', load, {
    revalidateOnFocus: false,
  });

  const parse = <T,>(value: string | null, fallback: T): T => {
    try {
      return (JSON.parse(value || '') ?? fallback) as T;
    } catch {
      return fallback;
    }
  };

  const [nodes, setNodes] = useState<Node[]>(() => parse<Node[]>(automation.nodes, []));
  const [edges, setEdges] = useState<Edge[]>(() => parse<Edge[]>(automation.edges, []));
  const [trigger, setTrigger] = useState(() => ({
    type: automation.triggerType || 'SCHEDULE',
    config: parse<Record<string, any>>(automation.triggerConfig, { intervalMinutes: 1440 }),
  }));

  /**
   * The chain, in order. Walked from the trigger through the `yes` side of any
   * condition, which is the path the list draws; the `no` side is shown as a
   * property of the condition step rather than a second column.
   */
  const chain = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const out: Node[] = [];
    let current = nodes.find((n) => n.type === 'TRIGGER')?.id;
    const seen = new Set<string>();

    while (current && !seen.has(current)) {
      seen.add(current);
      const node = byId.get(current);
      if (!node) break;
      out.push(node);
      const next = edges.find((e) => e.source === current && (!e.handle || e.handle === 'yes'));
      current = next?.target;
    }

    return out;
  }, [nodes, edges]);

  const addStep = (type: NodeType) => {
    const id = rid();
    // New steps land just before END, which is where a person means "and then"
    // when they click add.
    const endNode = nodes.find((n) => n.type === 'END');
    const before = chain[chain.length - 2] ?? chain[0];

    const node: Node = {
      id,
      type,
      label: STEP_LABELS[type],
      config: defaultsFor(type),
      position: { x: 0, y: chain.length * 120 },
    };

    setNodes([...nodes, node]);
    setEdges([
      ...edges.filter((e) => !(e.source === before?.id && e.target === endNode?.id && !e.handle)),
      { id: rid(), source: before?.id || 'trigger', target: id },
      ...(endNode ? [{ id: rid(), source: id, target: endNode.id }] : []),
    ]);
  };

  const removeStep = (id: string) => {
    const incoming = edges.find((e) => e.target === id && !e.handle);
    const outgoing = edges.find((e) => e.source === id && !e.handle);

    setNodes(nodes.filter((n) => n.id !== id));
    setEdges([
      ...edges.filter((e) => e.source !== id && e.target !== id),
      // Re-join the chain across the hole, otherwise removing a middle step
      // leaves everything after it unreachable and the save refuses to activate.
      ...(incoming && outgoing
        ? [{ id: rid(), source: incoming.source, target: outgoing.target }]
        : []),
    ]);
  };

  const setConfig = (id: string, key: string, value: any) =>
    setNodes(
      nodes.map((n) => (n.id === id ? { ...n, config: { ...n.config, [key]: value } } : n))
    );

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/automations/${automation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: automation.name,
          description: automation.description,
          triggerType: trigger.type,
          triggerConfig: trigger.config,
          nodes,
          edges,
        }),
      });

      const saved = await response.json();

      // The API validates on save but does not refuse — a half-drawn workflow is
      // a normal thing to leave behind. Surfacing the warnings here is what
      // stops "why won't it activate?" later.
      if (saved?.errors?.length) {
        toaster.show(`Saved. Before it can run: ${saved.errors.join(' ')}`, 'warning');
      } else {
        toaster.show('Saved', 'success');
      }
      onSaved();
    } catch {
      toaster.show('Could not save the workflow', 'warning');
    } finally {
      setSaving(false);
    }
  };

  const integrations = integrationList?.integrations || [];

  return (
    <div className="flex flex-col gap-[12px] mt-[16px]">
      <div className="border border-customColor6 rounded-[4px] p-[12px]">
        <div className="text-[12px] uppercase tracking-[0.14em] text-customColor18 mb-[8px]">
          Trigger
        </div>
        <div className="flex flex-wrap gap-[8px] mb-[10px]">
          {['SCHEDULE', 'POST_PUBLISHED', 'POST_SCHEDULED'].map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setTrigger({ ...trigger, type })}
              className={clsx(
                'px-[12px] py-[6px] rounded-full text-[13px] border transition-colors',
                trigger.type === type
                  ? 'bg-forth border-forth text-white'
                  : 'border-customColor6 text-customColor18'
              )}
            >
              {type.replace(/_/g, ' ').toLowerCase()}
            </button>
          ))}
        </div>

        {trigger.type === 'SCHEDULE' ? (
          <Input
          disableForm={true}
            label="Every (minutes) — minimum 5"
            name="intervalMinutes"
            type="number"
            value={String(trigger.config.intervalMinutes ?? 1440)}
            onChange={(e: any) =>
              setTrigger({
                ...trigger,
                config: { ...trigger.config, intervalMinutes: Number(e.target.value) },
              })
            }
          />
        ) : null}
      </div>

      {chain
        .filter((node) => node.type !== 'TRIGGER')
        .map((node) => (
          <div key={node.id} className="border border-customColor6 rounded-[4px] p-[12px]">
            <div className="flex items-center justify-between mb-[8px]">
              <div className="text-[14px]">{STEP_LABELS[node.type]}</div>
              {node.type !== 'END' ? (
                <button
                  type="button"
                  onClick={() => removeStep(node.id)}
                  className="text-[12px] text-customColor18 hover:text-[#ef4444]"
                >
                  remove
                </button>
              ) : null}
            </div>

            <StepConfig
              node={node}
              integrations={integrations}
              onChange={(key, value) => setConfig(node.id, key, value)}
            />
          </div>
        ))}

      <div className="flex flex-wrap gap-[8px]">
        {ADDABLE.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => addStep(type)}
            className="px-[12px] py-[6px] rounded-full text-[13px] border border-customColor6 text-customColor18 hover:border-customColor21"
          >
            + {STEP_LABELS[type]}
          </button>
        ))}
      </div>

      <div>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save workflow'}
        </Button>
      </div>
    </div>
  );
};

function defaultsFor(type: NodeType): Record<string, any> {
  switch (type) {
    case 'FETCH_RSS':
      return { url: '' };
    case 'HTTP_REQUEST':
      return { url: '', method: 'GET', headers: {}, body: {}, auth: { type: 'none' } };
    case 'CONDITION':
      return { left: '', operator: 'contains', right: '', caseSensitive: false };
    case 'GENERATE':
      return { prompt: '', humanize: true };
    case 'DELAY':
      return { amount: 1, unit: 'hours' };
    case 'PUBLISH':
      return { content: '', integrations: [], when: 'schedule', asDraft: true, delayMinutes: 0 };
    case 'WEBHOOK':
      return { url: '', body: {} };
    default:
      return {};
  }
}

const StepConfig = ({
  node,
  integrations,
  onChange,
}: {
  node: Node;
  integrations: any[];
  onChange: (key: string, value: any) => void;
}) => {
  const hint = (
    <div className="text-[12px] text-customColor18 mt-[4px]">
      Use <code>{'{{ stepId.field }}'}</code> to pull in an earlier step&apos;s output, for
      example <code>{'{{ ' + node.id + '.content }}'}</code>.
    </div>
  );

  switch (node.type) {
    case 'FETCH_RSS':
      return (
        <Input
          disableForm={true}
          label="Feed URL"
          name="url"
          value={node.config.url || ''}
          onChange={(e: any) => onChange('url', e.target.value)}
        />
      );

    case 'HTTP_REQUEST':
      return (
        <div className="flex flex-col gap-[8px]">
          <Input
          disableForm={true}
            label="URL"
            name="url"
            value={node.config.url || ''}
            onChange={(e: any) => onChange('url', e.target.value)}
          />
          <div className="flex gap-[8px]">
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange('method', m)}
                className={clsx(
                  'px-[10px] py-[4px] rounded-full text-[12px] border',
                  node.config.method === m
                    ? 'bg-forth border-forth text-white'
                    : 'border-customColor6 text-customColor18'
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      );

    case 'CONDITION':
      return (
        <div className="flex flex-col gap-[8px]">
          <Input
          disableForm={true}
            label="Compare this"
            name="left"
            value={node.config.left || ''}
            onChange={(e: any) => onChange('left', e.target.value)}
          />
          <div className="flex flex-wrap gap-[6px]">
            {[
              'contains',
              'not_contains',
              'equals',
              'not_equals',
              'matches',
              'greater_than',
              'less_than',
            ].map((op) => (
              <button
                key={op}
                type="button"
                onClick={() => onChange('operator', op)}
                className={clsx(
                  'px-[10px] py-[4px] rounded-full text-[12px] border',
                  node.config.operator === op
                    ? 'bg-forth border-forth text-white'
                    : 'border-customColor6 text-customColor18'
                )}
              >
                {op.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <Input
          disableForm={true}
            label="To this"
            name="right"
            value={node.config.right || ''}
            onChange={(e: any) => onChange('right', e.target.value)}
          />
          <div className="text-[12px] text-customColor18">
            When it does not match, the workflow stops here.
          </div>
          {hint}
        </div>
      );

    case 'GENERATE':
      return (
        <div className="flex flex-col gap-[8px]">
          <Textarea
          disableForm={true}
            label="Prompt"
            name="prompt"
            value={node.config.prompt || ''}
            onChange={(e: any) => onChange('prompt', e.target.value)}
          />
          <label className="flex items-center gap-[8px] text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={node.config.humanize !== false}
              onChange={(e) => onChange('humanize', e.target.checked)}
            />
            Strip AI-tells before using it
          </label>
          {hint}
        </div>
      );

    case 'DELAY':
      return (
        <div className="flex gap-[8px] items-end">
          <div className="flex-1">
            <Input
          disableForm={true}
              label="Wait"
              name="amount"
              type="number"
              value={String(node.config.amount ?? 1)}
              onChange={(e: any) => onChange('amount', Number(e.target.value))}
            />
          </div>
          <div className="flex gap-[6px] pb-[6px]">
            {['minutes', 'hours', 'days'].map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => onChange('unit', u)}
                className={clsx(
                  'px-[10px] py-[4px] rounded-full text-[12px] border',
                  node.config.unit === u
                    ? 'bg-forth border-forth text-white'
                    : 'border-customColor6 text-customColor18'
                )}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      );

    case 'PUBLISH':
      return (
        <div className="flex flex-col gap-[8px]">
          <Textarea
          disableForm={true}
            label="What to post"
            name="content"
            value={node.config.content || ''}
            onChange={(e: any) => onChange('content', e.target.value)}
          />
          <div className="flex flex-wrap gap-[6px]">
            {integrations.map((integration: any) => {
              const active = (node.config.integrations || []).includes(integration.id);
              return (
                <button
                  key={integration.id}
                  type="button"
                  onClick={() =>
                    onChange(
                      'integrations',
                      active
                        ? (node.config.integrations || []).filter(
                            (i: string) => i !== integration.id
                          )
                        : [...(node.config.integrations || []), integration.id]
                    )
                  }
                  className={clsx(
                    'px-[10px] py-[4px] rounded-full text-[12px] border',
                    active
                      ? 'bg-forth border-forth text-white'
                      : 'border-customColor6 text-customColor18'
                  )}
                >
                  {integration.name}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-[8px] text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={node.config.asDraft !== false}
              onChange={(e) => onChange('asDraft', e.target.checked)}
            />
            Create as a draft
            <span className="text-customColor18">
              — with this off, the workflow posts to a live audience on its own.
            </span>
          </label>
          {hint}
        </div>
      );

    case 'WEBHOOK':
      return (
        <Input
          disableForm={true}
          label="Webhook URL"
          name="url"
          value={node.config.url || ''}
          onChange={(e: any) => onChange('url', e.target.value)}
        />
      );

    default:
      return null;
  }
};
