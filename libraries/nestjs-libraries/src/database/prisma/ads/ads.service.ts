import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AdsRepository } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.repository';
import { AdsGenerator } from '@gitroom/nestjs-libraries/database/prisma/ads/ads.generator';
import { AdCampaignDto } from '@gitroom/nestjs-libraries/dtos/ads/ad.campaign.dto';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

@Injectable()
export class AdsService {
  constructor(
    private _adsRepository: AdsRepository,
    private _adsGenerator: AdsGenerator,
    private _postsService: PostsService
  ) {}

  getCampaigns(orgId: string) {
    return this._adsRepository.getCampaigns(orgId);
  }

  getCampaign(orgId: string, id: string) {
    return this._adsRepository.getCampaign(orgId, id);
  }

  deleteCampaign(orgId: string, id: string) {
    return this._adsRepository.deleteCampaign(orgId, id);
  }

  toggleVariant(orgId: string, variantId: string, selected: boolean) {
    return this._adsRepository.toggleVariant(orgId, variantId, selected);
  }

  /**
   * Create the brief, then fill it.
   *
   * The campaign row is written BEFORE generation and left in GENERATING: a
   * model call that takes 40 seconds and then fails would otherwise leave the
   * operator staring at a screen with no record that anything was attempted.
   */
  async create(orgId: string, body: AdCampaignDto) {
    const campaign = await this._adsRepository.createCampaign(orgId, body);

    try {
      const variants = await this._adsGenerator.generate(orgId, {
        name: body.name,
        objective: body.objective,
        product: body.product,
        audience: body.audience,
        offer: body.offer,
        platforms: body.platforms || [],
        angles: body.angles,
        stages: body.stages,
        perCombination: body.perCombination,
      });

      await this._adsRepository.replaceVariants(campaign.id, variants);
      await this._adsRepository.setStatus(campaign.id, 'READY');
    } catch (err) {
      const message = (err as Error)?.message || 'Generation failed.';
      await this._adsRepository.setStatus(campaign.id, 'FAILED', message);
      throw err;
    }

    return this._adsRepository.getCampaign(orgId, campaign.id);
  }

  /** Same brief, fresh set — the normal move when the first pass is close but flat. */
  async regenerate(orgId: string, id: string) {
    const campaign = await this._adsRepository.getCampaign(orgId, id);
    if (!campaign) {
      throw new NotFoundException('That campaign could not be found.');
    }

    await this._adsRepository.setStatus(campaign.id, 'GENERATING');

    try {
      const variants = await this._adsGenerator.generate(orgId, {
        name: campaign.name,
        objective: campaign.objective,
        product: campaign.product,
        audience: campaign.audience,
        offer: campaign.offer,
        platforms: JSON.parse(campaign.platforms || '[]'),
      });

      await this._adsRepository.replaceVariants(campaign.id, variants);
      await this._adsRepository.setStatus(campaign.id, 'READY');
    } catch (err) {
      await this._adsRepository.setStatus(
        campaign.id,
        'FAILED',
        (err as Error)?.message || 'Generation failed.'
      );
      throw err;
    }

    return this._adsRepository.getCampaign(orgId, campaign.id);
  }

  /**
   * Send selected variants to the calendar as DRAFTS.
   *
   * Drafts on purpose: an ad is written to be chosen between, and a generator
   * that can put copy straight into a live queue turns a test into a publish.
   */
  async scheduleVariants(
    orgId: string,
    variantIds: string[],
    integrationIds: string[],
    startAt?: string,
    everyHours = 24
  ) {
    const variants = await this._adsRepository.getVariants(orgId, variantIds);
    if (!variants.length) {
      throw new BadRequestException('None of those variants could be found.');
    }

    let when = startAt ? dayjs(startAt) : dayjs().add(1, 'hour');
    const created: string[] = [];

    for (const variant of variants) {
      const hashtags: string[] = JSON.parse(variant.hashtags || '[]');
      const content = [
        variant.headline,
        '',
        variant.primary,
        variant.cta ? `\n${variant.cta}` : '',
        hashtags.length ? `\n${hashtags.map((h) => `#${h}`).join(' ')}` : '',
      ]
        .filter((part) => part !== '')
        .join('\n')
        .trim();

      const group = makeId(10);

      const posts = await this._postsService.createPost(
        orgId,
        {
          type: 'draft',
          date: when.toISOString(),
          order: '',
          shortLink: false,
          tags: [],
          posts: integrationIds.map((id) => ({
            group,
            integration: { id },
            value: [{ content, id: undefined as any, delay: 0, image: [] }],
            settings: {} as any,
          })),
        } as any,
        'ads' as any
      );

      created.push(...(posts || []).map((p: any) => p?.id).filter(Boolean));
      when = when.add(everyHours, 'hour');
    }

    return { created: created.length, postIds: created };
  }
}
