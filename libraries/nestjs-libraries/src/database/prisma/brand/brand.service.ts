import { Injectable } from '@nestjs/common';
import { BrandRepository } from '@gitroom/nestjs-libraries/database/prisma/brand/brand.repository';
import { BrandAnalyzer } from '@gitroom/nestjs-libraries/database/prisma/brand/brand.analyzer';
import { BrandProfileDto } from '@gitroom/nestjs-libraries/dtos/brand/brand.profile.dto';
import { describeVoice } from '@gitroom/nestjs-libraries/database/prisma/brand/brand.voice';

/** The brand profile as the rest of the app consumes it: arrays already parsed. */
export interface BrandContext {
  name: string | null;
  website: string | null;
  description: string | null;
  audience: string | null;
  tone: string | null;
  voice: string[];
  language: string;
  colors: string[];
  keywords: string[];
  avoid: string[];
}

@Injectable()
export class BrandService {
  constructor(
    private _brandRepository: BrandRepository,
    private _brandAnalyzer: BrandAnalyzer
  ) {}

  get(orgId: string) {
    return this._brandRepository.get(orgId);
  }

  save(orgId: string, body: BrandProfileDto) {
    return this._brandRepository.save(orgId, body);
  }

  async analyze(orgId: string, website: string) {
    const analysis = await this._brandAnalyzer.analyze(orgId, website);
    return this._brandRepository.saveAnalysis(orgId, analysis);
  }

  /**
   * The profile in the shape a generator wants. JSON columns are parsed behind a
   * guard: a hand-edited row with malformed JSON must degrade to "no brand set"
   * rather than throw inside every generation that reads it.
   */
  async context(orgId: string): Promise<BrandContext | null> {
    const row = await this._brandRepository.get(orgId);
    if (!row) {
      return null;
    }

    const list = (value: string | null): string[] => {
      try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return [];
      }
    };

    return {
      name: row.name,
      website: row.website,
      description: row.description,
      audience: row.audience,
      tone: row.tone,
      voice: list(row.voice),
      language: row.language,
      colors: list(row.colors),
      keywords: list(row.keywords),
      avoid: list(row.avoid),
    };
  }

  /**
   * The brand as prompt text, prepended to every generation.
   *
   * Returns '' when nothing is configured — that is deliberate. An empty brand
   * rendered as a block of "Name: none / Tone: none" teaches the model that
   * blankness is a property of the brand, and the output gets blander for it.
   */
  async prompt(orgId: string): Promise<string> {
    const brand = await this.context(orgId);
    if (!brand) {
      return '';
    }

    const lines: string[] = [];
    if (brand.name) lines.push(`Brand: ${brand.name}`);
    if (brand.description) lines.push(`What it does: ${brand.description}`);
    if (brand.audience) lines.push(`Audience: ${brand.audience}`);
    if (brand.voice.length) lines.push(`Voice: ${describeVoice(brand.voice)}`);
    if (brand.tone) lines.push(`Tone: ${brand.tone}`);
    if (brand.keywords.length) lines.push(`Language it uses: ${brand.keywords.join(', ')}`);
    if (brand.avoid.length) lines.push(`Never use: ${brand.avoid.join(', ')}`);
    if (brand.language) lines.push(`Write in: ${brand.language}`);

    if (!lines.length) {
      return '';
    }

    return `Write as this brand.\n${lines.join('\n')}`;
  }
}
