'use client';

import useSWR from 'swr';
import { useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { Textarea } from '@gitroom/react/form/textarea';
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

export const AdsComponent = () => {
  const fetch = useFetch();
  const toaster = useToaster();

  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [brief, setBrief] = useState({
    name: '',
    objective: 'leads',
    product: '',
    audience: '',
    offer: '',
    platforms: ['linkedin'] as string[],
  });

  const load = useCallback(async (path: string) => (await (await fetch(path)).json()) ?? null, []);

  const { data: options } = useSWR('/ads/options', load, { revalidateOnFocus: false });
  const { data: campaigns, isLoading, mutate } = useSWR('/ads', load, {
    revalidateOnFocus: false,
  });
  const { data: integrations } = useSWR('/integrations/list', load, {
    revalidateOnFocus: false,
  });
  const { data: open } = useSWR(openId ? `/ads/${openId}` : null, load);

  const create = async () => {
    if (!brief.name.trim()) {
      toaster.show('Give the campaign a name', 'warning');
      return;
    }

    setCreating(true);
    try {
      const response = await fetch('/ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(brief),
      });

      if (!response.ok) {
        throw new Error('failed');
      }

      const created = await response.json();
      toaster.show('Variants generated', 'success');
      setOpenId(created?.id || null);
      mutate();
    } catch {
      toaster.show('The variants could not be generated', 'warning');
    } finally {
      setCreating(false);
    }
  };

  const togglePlatform = (key: string) => {
    setBrief({
      ...brief,
      platforms: brief.platforms.includes(key)
        ? brief.platforms.filter((p) => p !== key)
        : [...brief.platforms, key],
    });
  };

  if (isLoading) {
    return <LoadingComponent />;
  }

  const platforms = Array.from(
    new Set((integrations?.integrations || []).map((i: any) => i.identifier).filter(Boolean))
  ) as string[];

  return (
    <div className="flex flex-col gap-[16px]">
      <h1 className="text-[24px]">Ads</h1>
      <div className="text-[14px] text-customColor18">
        A brief goes in, a matrix of variants comes out: every one takes a different angle at a
        different stage of the funnel, so a test tells you which argument works rather than which
        wording. Written in your brand voice, scored, and never published without you.
      </div>

      <div className="bg-sixth border border-customColor6 rounded-[4px] p-[24px] flex flex-col gap-[16px]">
        <Input
          disableForm={true}
          label="Campaign name"
          name="name"
          value={brief.name}
          onChange={(e: any) => setBrief({ ...brief, name: e.target.value })}
        />

        <div className="flex flex-col gap-[8px]">
          <div className="text-[12px] uppercase tracking-[0.14em] text-customColor18">
            Objective
          </div>
          <div className="flex flex-wrap gap-[8px]">
            {(options?.objectives || []).map((objective: string) => (
              <button
                key={objective}
                type="button"
                onClick={() => setBrief({ ...brief, objective })}
                className={clsx(
                  'px-[12px] py-[6px] rounded-full text-[13px] border transition-colors',
                  brief.objective === objective
                    ? 'bg-forth border-forth text-white'
                    : 'border-customColor6 text-customColor18'
                )}
              >
                {objective.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>

        <Textarea
          disableForm={true}
          label="What you sell"
          name="product"
          value={brief.product}
          onChange={(e: any) => setBrief({ ...brief, product: e.target.value })}
        />
        <Textarea
          disableForm={true}
          label="Who it is for"
          name="audience"
          value={brief.audience}
          onChange={(e: any) => setBrief({ ...brief, audience: e.target.value })}
        />
        <Textarea
          disableForm={true}
          label="The offer"
          name="offer"
          value={brief.offer}
          onChange={(e: any) => setBrief({ ...brief, offer: e.target.value })}
        />

        {platforms.length ? (
          <div className="flex flex-col gap-[8px]">
            <div className="text-[12px] uppercase tracking-[0.14em] text-customColor18">
              Write for
            </div>
            <div className="flex flex-wrap gap-[8px]">
              {platforms.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => togglePlatform(key)}
                  className={clsx(
                    'px-[12px] py-[6px] rounded-full text-[13px] border transition-colors',
                    brief.platforms.includes(key)
                      ? 'bg-forth border-forth text-white'
                      : 'border-customColor6 text-customColor18'
                  )}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <Button onClick={create} disabled={creating}>
            {creating ? 'Writing variants...' : 'Generate variants'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-[10px]">
        <div className="text-[18px]">Campaigns</div>
        {!(campaigns || []).length ? (
          <div className="text-[14px] text-customColor18">Nothing yet.</div>
        ) : null}

        {(campaigns || []).map((campaign: any) => (
          <div
            key={campaign.id}
            className="bg-sixth border border-customColor6 rounded-[4px] p-[16px]"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[16px]">{campaign.name}</div>
                <div className="text-[12px] text-customColor18">
                  {campaign.objective} · {campaign._count?.variants ?? 0} variants ·{' '}
                  {campaign.status}
                </div>
              </div>
              <Button
                secondary={true}
                onClick={() => setOpenId(openId === campaign.id ? null : campaign.id)}
              >
                {openId === campaign.id ? 'Hide' : 'Open'}
              </Button>
            </div>

            {openId === campaign.id && open?.variants ? (
              <div className="mt-[16px] flex flex-col gap-[10px]">
                {open.variants.map((variant: any) => (
                  <div
                    key={variant.id}
                    className="border border-customColor6 rounded-[4px] p-[12px]"
                  >
                    <div className="flex items-center gap-[8px] mb-[6px]">
                      <span className="text-[11px] uppercase tracking-[0.12em] text-customColor18">
                        {variant.platform} · {variant.angle.replace(/_/g, ' ')} · {variant.stage}
                      </span>
                      <span className="text-[11px] tabular-nums text-customColor18">
                        {variant.score}/100
                      </span>
                    </div>
                    <div className="text-[15px] mb-[4px]">{variant.headline}</div>
                    <div className="text-[14px] text-customColor18 whitespace-pre-wrap">
                      {variant.primary}
                    </div>
                    {variant.cta ? (
                      <div className="text-[13px] mt-[6px]">{variant.cta}</div>
                    ) : null}
                    {list(variant.hashtags).length ? (
                      <div className="text-[12px] text-customColor18 mt-[6px]">
                        {list(variant.hashtags).map((h) => `#${h}`).join(' ')}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};
