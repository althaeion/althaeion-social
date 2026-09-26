import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { SafeHttpFetcher } from '@gitroom/nestjs-libraries/services/safe.http.fetcher';
import {
  BRAND_VOICE_GROUPS,
  BRAND_VOICE_TRAITS,
  SINGLE_SELECT_GROUPS,
  normalizeVoiceTraits,
} from '@gitroom/nestjs-libraries/database/prisma/brand/brand.voice';
import { AiUsageService } from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai.usage.service';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-proj-',
});

const BrandAnalysis = z.object({
  name: z
    .string()
    .describe(
      'The actual brand or company name (1-4 words). Strip any tagline, slogan, or product descriptor — return only the brand identity itself.'
    ),
  description: z
    .string()
    .describe(
      'A concise 2-3 sentence brand description summarizing what the company does, who they serve, and what makes them unique. Written in the detected content language.'
    ),
  audience: z
    .string()
    .describe('Who this brand sells to, in one sentence. Empty string if the site does not say.'),
  language: z.string().describe('The primary language of the content, as an ISO 639-1 code.'),
  brand_color: z
    .string()
    .describe(
      'The primary brand color as a hex string starting with # (e.g. "#0ea5e9"). Pick the most prominent accent color used in CTAs, links, or logos. Return empty string if not confidently identifiable.'
    ),
  background_color: z
    .string()
    .describe(
      'The dominant page background color as a hex string starting with #. Return empty string if not confidently identifiable.'
    ),
  text_color: z
    .string()
    .describe(
      'The dominant body text color as a hex string starting with #. Return empty string if not confidently identifiable.'
    ),
  keywords: z
    .array(z.string())
    .describe('Up to 8 terms this brand repeatedly uses about itself.'),
  avoid: z
    .array(z.string())
    .describe(
      'Up to 6 words or claims this brand visibly avoids — jargon it never uses, hype it stays away from. Empty array if nothing stands out.'
    ),
  voice_traits: z
    .array(z.enum(BRAND_VOICE_TRAITS as [string, ...string[]]))
    .describe(
      'Brand voice traits inferred from the site, using only the allowed values. Pick AT MOST ONE per single-select dimension and any number of style traits.'
    ),
});

/**
 * Reads a brand's own website and fills its profile, so the operator is not
 * asked to describe their own tone from a blank box — the answer is already
 * published on their homepage.
 *
 * The page is fetched through SafeHttpFetcher: this takes a URL straight from a
 * user, which is the exact shape of an SSRF.
 */
@Injectable()
export class BrandAnalyzer {
  constructor(
    private _safeHttpFetcher: SafeHttpFetcher,
    private _aiUsageService: AiUsageService
  ) {}

  async analyze(orgId: string, website: string) {
    const { body, finalUrl } = await this._safeHttpFetcher.get(website);
    const text = this.readableText(body);

    if (text.length < 80) {
      throw new Error('That page had too little text to read a brand from.');
    }

    const groups = Object.entries(BRAND_VOICE_GROUPS)
      .map(
        ([group, traits]) =>
          `- ${group}${
            SINGLE_SELECT_GROUPS.includes(group as any) ? ' (pick at most ONE)' : ' (pick any)'
          }: ${traits.join(', ')}`
      )
      .join('\n');

    const completion = await openai.chat.completions.parse({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content:
            'You read a company website and describe the brand behind it. Report only what the page supports — if the site does not show something, return an empty string or an empty array rather than inventing it.\n\n' +
            `Voice dimensions:\n${groups}`,
        },
        {
          role: 'user',
          content: `URL: ${finalUrl}\n\nPage content:\n${text.slice(0, 12000)}`,
        },
      ],
      response_format: zodResponseFormat(BrandAnalysis, 'brandAnalysis'),
    });

    await this._aiUsageService.record(orgId, {
      kind: 'text',
      provider: 'openai',
      model: 'gpt-4.1',
      feature: 'brand_analyze',
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
    });

    const parsed = completion.choices[0].message.parsed;
    if (!parsed) {
      throw new Error('The brand could not be read from that page.');
    }

    const colors = [parsed.brand_color, parsed.background_color, parsed.text_color]
      .map((c) => (c || '').trim())
      // A model asked for "empty string if unsure" also returns "none", "n/a" and
      // bare words; only a real hex triplet is worth storing as a colour.
      .filter((c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c));

    return {
      name: parsed.name?.trim() || null,
      website: finalUrl,
      description: parsed.description?.trim() || null,
      audience: parsed.audience?.trim() || null,
      language: (parsed.language || 'en').slice(0, 5),
      colors,
      keywords: (parsed.keywords || []).map((k) => k.trim()).filter(Boolean).slice(0, 8),
      avoid: (parsed.avoid || []).map((k) => k.trim()).filter(Boolean).slice(0, 6),
      voice: normalizeVoiceTraits(parsed.voice_traits),
    };
  }

  /**
   * Strip a page down to what a reader sees. Scripts and styles are dropped
   * first — a minified bundle left in place is most of the token budget and
   * none of the meaning.
   */
  private readableText(html: string): string {
    return html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
}
