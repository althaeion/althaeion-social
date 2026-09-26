import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AdCampaignDto } from '@gitroom/nestjs-libraries/dtos/ads/ad.campaign.dto';

@Injectable()
export class AdsRepository {
  constructor(
    private _adCampaign: PrismaRepository<'adCampaign'>,
    private _adVariant: PrismaRepository<'adVariant'>
  ) {}

  getCampaigns(orgId: string) {
    return this._adCampaign.model.adCampaign.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { variants: true } } },
    });
  }

  getCampaign(orgId: string, id: string) {
    return this._adCampaign.model.adCampaign.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: { variants: { orderBy: [{ selected: 'desc' }, { score: 'desc' }] } },
    });
  }

  createCampaign(orgId: string, body: AdCampaignDto) {
    return this._adCampaign.model.adCampaign.create({
      data: {
        organizationId: orgId,
        name: body.name,
        objective: body.objective,
        product: body.product ?? null,
        audience: body.audience ?? null,
        offer: body.offer ?? null,
        platforms: JSON.stringify(body.platforms || []),
        status: 'GENERATING',
      },
    });
  }

  setStatus(id: string, status: 'DRAFT' | 'GENERATING' | 'READY' | 'FAILED', error?: string) {
    return this._adCampaign.model.adCampaign.update({
      where: { id },
      data: { status, error: error ? error.slice(0, 1000) : null },
    });
  }

  /**
   * Replaces the whole set. Regenerating means "these are the variants now" —
   * appending would silently mix two briefs in one campaign.
   */
  async replaceVariants(
    campaignId: string,
    variants: {
      platform: string;
      angle: string;
      stage: string;
      headline: string;
      primary: string;
      cta: string | null;
      hashtags: string[];
      imagePrompt: string | null;
      score: number;
    }[]
  ) {
    await this._adVariant.model.adVariant.deleteMany({ where: { campaignId } });

    if (!variants.length) {
      return [];
    }

    await this._adVariant.model.adVariant.createMany({
      data: variants.map((v) => ({
        campaignId,
        platform: v.platform,
        angle: v.angle,
        stage: v.stage,
        headline: v.headline,
        primary: v.primary,
        cta: v.cta,
        hashtags: JSON.stringify(v.hashtags || []),
        imagePrompt: v.imagePrompt,
        score: v.score,
      })),
    });

    return this._adVariant.model.adVariant.findMany({
      where: { campaignId },
      orderBy: { score: 'desc' },
    });
  }

  toggleVariant(orgId: string, variantId: string, selected: boolean) {
    return this._adVariant.model.adVariant.updateMany({
      // Scoped through the campaign so a variant id from another organisation
      // cannot be toggled by guessing it.
      where: { id: variantId, campaign: { organizationId: orgId, deletedAt: null } },
      data: { selected },
    });
  }

  getVariants(orgId: string, ids: string[]) {
    return this._adVariant.model.adVariant.findMany({
      where: { id: { in: ids }, campaign: { organizationId: orgId, deletedAt: null } },
    });
  }

  setVariantImage(variantId: string, imageUrl: string) {
    return this._adVariant.model.adVariant.update({
      where: { id: variantId },
      data: { imageUrl },
    });
  }

  deleteCampaign(orgId: string, id: string) {
    return this._adCampaign.model.adCampaign.update({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }
}
