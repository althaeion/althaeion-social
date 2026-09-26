import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { BrandProfileDto } from '@gitroom/nestjs-libraries/dtos/brand/brand.profile.dto';
import { normalizeVoiceTraits } from '@gitroom/nestjs-libraries/database/prisma/brand/brand.voice';

@Injectable()
export class BrandRepository {
  constructor(private _brandProfile: PrismaRepository<'brandProfile'>) {}

  get(orgId: string) {
    return this._brandProfile.model.brandProfile.findUnique({
      where: { organizationId: orgId },
    });
  }

  save(orgId: string, body: BrandProfileDto) {
    const data = {
      name: body.name ?? null,
      website: body.website ?? null,
      description: body.description ?? null,
      audience: body.audience ?? null,
      tone: body.tone ?? null,
      voice: JSON.stringify(normalizeVoiceTraits(body.voice || [])),
      language: body.language || 'en',
      colors: JSON.stringify(body.colors || []),
      keywords: JSON.stringify(body.keywords || []),
      avoid: JSON.stringify(body.avoid || []),
    };

    return this._brandProfile.model.brandProfile.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...data },
      update: data,
    });
  }

  /** Written by the analyzer, which also stamps analyzedAt so the UI can say when. */
  saveAnalysis(
    orgId: string,
    analysis: {
      name: string | null;
      website: string;
      description: string | null;
      audience: string | null;
      language: string;
      colors: string[];
      keywords: string[];
      avoid: string[];
      voice: string[];
    }
  ) {
    const data = {
      name: analysis.name,
      website: analysis.website,
      description: analysis.description,
      audience: analysis.audience,
      language: analysis.language,
      colors: JSON.stringify(analysis.colors),
      keywords: JSON.stringify(analysis.keywords),
      avoid: JSON.stringify(analysis.avoid),
      voice: JSON.stringify(analysis.voice),
      analyzedAt: new Date(),
    };

    return this._brandProfile.model.brandProfile.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...data },
      update: data,
    });
  }
}
