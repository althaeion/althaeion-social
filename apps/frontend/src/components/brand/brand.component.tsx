'use client';

import useSWR from 'swr';
import { useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { Textarea } from '@gitroom/react/form/textarea';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import clsx from 'clsx';

interface BrandRow {
  name?: string | null;
  website?: string | null;
  description?: string | null;
  audience?: string | null;
  tone?: string | null;
  voice?: string | null;
  language?: string | null;
  colors?: string | null;
  keywords?: string | null;
  avoid?: string | null;
  analyzedAt?: string | null;
}

const list = (value?: string | null): string[] => {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

export const BrandComponent = () => {
  const fetch = useFetch();
  const toaster = useToaster();

  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [form, setForm] = useState<Record<string, any> | null>(null);

  const load = useCallback(async (path: string) => (await (await fetch(path)).json()) ?? null, []);

  const { data: brand, isLoading, mutate } = useSWR<BrandRow>('/brand', load, {
    revalidateOnFocus: false,
  });
  const { data: options } = useSWR('/brand/voice-options', load, { revalidateOnFocus: false });
  const { data: usage } = useSWR('/brand/usage', load, { revalidateOnFocus: false });

  // The saved row is the source of truth until the operator edits something;
  // seeding state from it on every render would fight their typing.
  const state = useMemo(
    () =>
      form ?? {
        name: brand?.name ?? '',
        website: brand?.website ?? '',
        description: brand?.description ?? '',
        audience: brand?.audience ?? '',
        tone: brand?.tone ?? '',
        language: brand?.language ?? 'en',
        voice: list(brand?.voice),
        keywords: list(brand?.keywords),
        avoid: list(brand?.avoid),
        colors: list(brand?.colors),
      },
    [form, brand]
  );

  const set = (key: string, value: any) => setForm({ ...state, [key]: value });

  const toggleTrait = (group: string, trait: string, single: boolean) => {
    const current: string[] = state.voice || [];
    const groupTraits: string[] = options?.groups?.[group] || [];

    if (current.includes(trait)) {
      set('voice', current.filter((t) => t !== trait));
      return;
    }

    // A single-select dimension replaces its own value: asking a model to be
    // both formal and casual makes the output drift, so the UI cannot express it.
    const cleaned = single ? current.filter((t) => !groupTraits.includes(t)) : current;
    set('voice', [...cleaned, trait]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await fetch('/brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      toaster.show('Brand profile saved', 'success');
      setForm(null);
      mutate();
    } catch {
      toaster.show('Could not save the brand profile', 'warning');
    } finally {
      setSaving(false);
    }
  };

  const analyze = async () => {
    if (!state.website) {
      toaster.show('Add your website address first', 'warning');
      return;
    }

    setAnalyzing(true);
    try {
      const response = await fetch('/brand/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website: state.website }),
      });

      if (!response.ok) {
        throw new Error('analyze failed');
      }

      toaster.show('Read your site and filled the profile', 'success');
      setForm(null);
      mutate();
    } catch {
      toaster.show('That page could not be read', 'warning');
    } finally {
      setAnalyzing(false);
    }
  };

  if (isLoading) {
    return <LoadingComponent />;
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex items-center gap-[10px]">
        <h1 className="text-[24px]">Brand</h1>
        {brand?.analyzedAt ? (
          <span className="text-[12px] text-customColor18">
            read from your site on {new Date(brand.analyzedAt).toLocaleDateString()}
          </span>
        ) : null}
      </div>

      <div className="text-[14px] text-customColor18">
        Everything the AI writes reads this first: posts, captions, ads and anything the
        autopilot queues. Filling it in is the difference between copy that sounds like you and
        copy that sounds like a model.
      </div>

      <div className="bg-sixth border border-customColor6 rounded-[4px] p-[24px] flex flex-col gap-[16px]">
        <div className="flex gap-[10px] items-end">
          <div className="flex-1">
            <Input
          disableForm={true}
              label="Website"
              name="website"
              value={state.website}
              onChange={(e: any) => set('website', e.target.value)}
              placeholder="yourbrand.com"
            />
          </div>
          <Button onClick={analyze} disabled={analyzing} secondary={true}>
            {analyzing ? 'Reading your site...' : 'Fill from my site'}
          </Button>
        </div>

        <Input
          disableForm={true}
          label="Brand name"
          name="name"
          value={state.name}
          onChange={(e: any) => set('name', e.target.value)}
        />

        <Textarea
          disableForm={true}
          label="What it does"
          name="description"
          value={state.description}
          onChange={(e: any) => set('description', e.target.value)}
        />

        <Textarea
          disableForm={true}
          label="Audience"
          name="audience"
          value={state.audience}
          onChange={(e: any) => set('audience', e.target.value)}
        />
      </div>

      <div className="bg-sixth border border-customColor6 rounded-[4px] p-[24px] flex flex-col gap-[16px]">
        <div className="text-[18px]">Voice</div>
        <div className="text-[13px] text-customColor18">
          Dimensions marked &quot;one&quot; are mutually exclusive: picking a new value replaces
          the old one.
        </div>

        {Object.entries(options?.groups || {}).map(([group, traits]) => {
          const single = (options?.singleSelect || []).includes(group);
          return (
            <div key={group} className="flex flex-col gap-[8px]">
              <div className="text-[12px] uppercase tracking-[0.14em] text-customColor18">
                {group} {single ? '(one)' : ''}
              </div>
              <div className="flex flex-wrap gap-[8px]">
                {(traits as string[]).map((trait) => {
                  const active = (state.voice || []).includes(trait);
                  return (
                    <button
                      key={trait}
                      type="button"
                      onClick={() => toggleTrait(group, trait, single)}
                      className={clsx(
                        'px-[12px] py-[6px] rounded-full text-[13px] border transition-colors',
                        active
                          ? 'bg-forth border-forth text-white'
                          : 'border-customColor6 text-customColor18 hover:border-customColor21'
                      )}
                    >
                      {trait.replace(/_/g, ' ')}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-sixth border border-customColor6 rounded-[4px] p-[24px] flex flex-col gap-[16px]">
        <Input
          disableForm={true}
          label="Words it uses (comma separated)"
          name="keywords"
          value={(state.keywords || []).join(', ')}
          onChange={(e: any) =>
            set('keywords', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))
          }
        />
        <Input
          disableForm={true}
          label="Never use (comma separated)"
          name="avoid"
          value={(state.avoid || []).join(', ')}
          onChange={(e: any) =>
            set('avoid', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))
          }
        />
        <Input
          disableForm={true}
          label="Write in (language code)"
          name="language"
          value={state.language}
          onChange={(e: any) => set('language', e.target.value)}
        />
      </div>

      {usage ? (
        <div className="bg-sixth border border-customColor6 rounded-[4px] p-[24px]">
          <div className="text-[18px] mb-[10px]">AI spend, last 30 days</div>
          <div className="text-[28px] mb-[10px]">{usage.total} credits</div>
          <div className="flex flex-col gap-[6px]">
            {(usage.breakdown || []).map((row: any, i: number) => (
              <div key={i} className="flex justify-between text-[13px] text-customColor18">
                <span>
                  {row.feature || row.kind} · {row.calls} calls
                </span>
                <span className="tabular-nums">{row.credits} credits</span>
              </div>
            ))}
            {!(usage.breakdown || []).length ? (
              <div className="text-[13px] text-customColor18">Nothing spent yet.</div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save brand profile'}
        </Button>
      </div>
    </div>
  );
};
