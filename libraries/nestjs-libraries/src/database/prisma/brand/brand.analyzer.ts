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
  language: z
    .string()
    .describe('The primary language of the content, as a two-letter ISO 639-1 code such as "en" or "fr".'),
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

const LANGUAGE_NAMES: Record<string, string> = {
  english: 'en', eng: 'en', french: 'fr', français: 'fr', francais: 'fr', fra: 'fr', fre: 'fr',
  spanish: 'es', español: 'es', espanol: 'es', spa: 'es', german: 'de', deutsch: 'de', deu: 'de', ger: 'de',
  italian: 'it', italiano: 'it', ita: 'it', portuguese: 'pt', português: 'pt', portugues: 'pt', por: 'pt',
  dutch: 'nl', nederlands: 'nl', nld: 'nl', polish: 'pl', polski: 'pl', swedish: 'sv', svenska: 'sv',
  danish: 'da', dansk: 'da', norwegian: 'no', norsk: 'no', finnish: 'fi', suomi: 'fi', turkish: 'tr',
  türkçe: 'tr', russian: 'ru', ukrainian: 'uk', czech: 'cs', greek: 'el', romanian: 'ro', hungarian: 'hu',
  japanese: 'ja', chinese: 'zh', mandarin: 'zh', korean: 'ko', arabic: 'ar', hebrew: 'he', hindi: 'hi',
  indonesian: 'id', vietnamese: 'vi', thai: 'th', malay: 'ms',
};

/**
 * The language the model reports, as the short code every draft is written in.
 * The schema asks for an ISO 639-1 code, but free models also answer with a
 * name ("French") or a sentence ("French context (operates in Lyon, ...)"), and
 * cutting that to five characters stored "Frenc" as the brand's language.
 */
function languageCode(raw: unknown): string {
  const value = String(raw || '').trim();
  const code = /^([a-z]{2})(?:[-_]([a-z]{2}))?$/i.exec(value);
  if (code) {
    return code[2]
      ? `${code[1].toLowerCase()}-${code[2].toUpperCase()}`
      : code[1].toLowerCase();
  }

  for (const word of value.toLowerCase().split(/[^a-zÀ-ɏ]+/)) {
    if (LANGUAGE_NAMES[word]) {
      return LANGUAGE_NAMES[word];
    }
  }

  return 'en';
}

// The most frequent short words of each language: counted in the page's own text, they tell
// its language without a model. Measured 27/09: a free model answered "en" for a page written
// entirely in French.
const STOPWORDS: Record<string, string[]> = {
  en: ['the', 'and', 'of', 'to', 'is', 'for', 'with', 'you', 'your', 'our', 'we', 'are', 'on', 'in'],
  fr: ['le', 'la', 'les', 'des', 'et', 'du', 'un', 'une', 'pour', 'avec', 'nous', 'vous', 'est', 'dans', 'sur', 'notre', 'votre'],
  es: ['el', 'los', 'las', 'del', 'y', 'para', 'con', 'una', 'por', 'nuestro', 'nuestra', 'es', 'en', 'su'],
  de: ['der', 'die', 'das', 'und', 'mit', 'für', 'ist', 'wir', 'sie', 'ein', 'eine', 'unsere', 'ihre', 'auf'],
  it: ['il', 'lo', 'gli', 'della', 'e', 'per', 'con', 'una', 'che', 'nostro', 'nostra', 'sono', 'nel', 'di'],
  pt: ['o', 'os', 'as', 'da', 'do', 'e', 'para', 'com', 'uma', 'que', 'nosso', 'nossa', 'são', 'em'],
  nl: ['de', 'het', 'een', 'en', 'van', 'voor', 'met', 'wij', 'onze', 'jouw', 'uw', 'is', 'op', 'zijn'],
};

/**
 * The language of a page, from what the page itself says: its `<html lang>` first,
 * then its most frequent short words (only when one language clearly wins). Empty
 * when neither is conclusive, so the model's answer is used.
 */
export function pageLanguage(html: string, text: string): string {
  const declared = /<html[^>]*\slang\s*=\s*["']?([a-zA-Z]{2})(?:[-_][a-zA-Z]{2})?/i.exec(html || '');
  if (declared) {
    return declared[1].toLowerCase();
  }

  const words = (text || '').toLowerCase().split(/[^a-zà-ɏ]+/).filter(Boolean).slice(0, 3000);
  if (words.length < 30) {
    return '';
  }
  const scores = Object.entries(STOPWORDS)
    .map(([lang, list]) => [lang, words.filter((w) => list.includes(w)).length] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  return best[1] >= 8 && best[1] >= 2 * second[1] ? best[0] : '';
}

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
      language: pageLanguage(body, text) || languageCode(parsed.language),
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
