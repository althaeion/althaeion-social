import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import {
  HUMANIZER_RULES,
  HUMANIZER_FINAL_CHECK,
  copyBudget,
  stripAiTypography,
} from '@gitroom/nestjs-libraries/openai/humanizer.prompt';
import { BrandService } from '@gitroom/nestjs-libraries/database/prisma/brand/brand.service';
import { AiUsageService } from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai.usage.service';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-proj-',
});

const Humanized = z.object({
  content: z.string(),
});

const Review = z.object({
  suggestions: z
    .array(
      z.object({
        original: z.string().describe('The exact substring of the input that needs correction.'),
        suggestion: z.string().describe('The corrected version.'),
        reason: z.string().describe('1-line explanation in the output language.'),
      })
    )
    .describe('Up to 8 grammar/spelling/clarity suggestions. Empty array if the text is fine.'),
});

/**
 * The second pass over generated copy.
 *
 * Postiz could write a post but had nothing between "the model produced text"
 * and "it goes out". Two passes fill that: `review` returns targeted
 * suggestions the author can accept or ignore, and `humanize` rewrites away the
 * patterns that make copy read as machine-written.
 */
@Injectable()
export class ContentEditorService {
  constructor(
    private _brandService: BrandService,
    private _aiUsageService: AiUsageService
  ) {}

  /**
   * Rewrite to remove AI-tells. Never throws on a model failure: the caller is
   * holding text the user already has, so a failed rewrite returns the original
   * rather than losing it.
   */
  async humanize(orgId: string, content: string, platform?: string): Promise<string> {
    if (!content?.trim()) {
      return content;
    }

    const budget = copyBudget(platform);
    const brand = await this._brandService.prompt(orgId);

    try {
      const completion = await openai.chat.completions.parse({
        model: 'gpt-4.1',
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content:
              'You are a copy editor that rewrites social media text to remove AI-generated patterns and make it sound like a real person wrote it.\n\n' +
              (brand ? `${brand}\n\n` : '') +
              `## CRITICAL — length limit for ${platform || 'this platform'}\n` +
              'The rewritten text MUST fit this platform. This overrides the "match original length" guidance below:\n' +
              `- Hard cap (must NEVER exceed): ${budget.hard} characters total, including spaces, line breaks, hashtags and emojis.\n` +
              `- Sweet spot: around ${budget.sweet} characters. Concise posts perform better.\n` +
              '- If a faithful rewrite would exceed the cap, cut words — never go over. Count before responding.\n\n' +
              `${HUMANIZER_RULES}\n\n${HUMANIZER_FINAL_CHECK}`,
          },
          { role: 'user', content },
        ],
        response_format: zodResponseFormat(Humanized, 'humanized'),
      });

      await this._aiUsageService.record(orgId, {
        kind: 'text',
        provider: 'openai',
        model: 'gpt-4.1',
        feature: 'humanize',
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
      });

      const rewritten = completion.choices[0].message.parsed?.content?.trim();
      if (!rewritten) {
        return content;
      }

      const cleaned = stripAiTypography(rewritten);

      // A rewrite that blew the cap is worse than no rewrite: it would fail at
      // publish time instead of here, after the user had already approved it.
      return cleaned.length > budget.hard ? content : cleaned;
    } catch (err) {
      console.error('[humanize] rewrite failed, keeping the original', {
        orgId,
        error: (err as Error)?.message,
      });
      return content;
    }
  }

  /**
   * Grammar, spelling and clarity suggestions. Returns anchored edits
   * (`original` -> `suggestion`) rather than a rewritten blob, so the UI can
   * offer them one at a time and the author stays the author.
   */
  async review(
    orgId: string,
    content: string
  ): Promise<{ original: string; suggestion: string; reason: string }[]> {
    if (!content?.trim()) {
      return [];
    }

    const brand = await this._brandService.context(orgId);

    try {
      const completion = await openai.chat.completions.parse({
        model: 'gpt-4.1',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You review social media copy and return targeted corrections. Only flag real problems: grammar, spelling, and sentences a reader would have to re-read. Do not rewrite for taste, and do not suggest changes to facts, numbers, names, hashtags, URLs or mentions.\n' +
              'Every `original` must be an EXACT substring of the input, copied character for character, so the editor can locate it.\n' +
              `Write reasons in ${brand?.language || 'the language of the input'}.`,
          },
          { role: 'user', content },
        ],
        response_format: zodResponseFormat(Review, 'review'),
      });

      await this._aiUsageService.record(orgId, {
        kind: 'text',
        provider: 'openai',
        model: 'gpt-4.1',
        feature: 'review',
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
      });

      const suggestions = completion.choices[0].message.parsed?.suggestions || [];

      // Drop anything whose `original` is not actually in the text. The UI
      // highlights by substring match, so a hallucinated anchor would either
      // highlight nothing or, worse, the wrong span.
      //
      // The parsed shape has every field optional, so the surviving rows are
      // rebuilt explicitly rather than asserted — a suggestion missing its
      // replacement would otherwise reach the editor as `undefined`.
      return suggestions
        .filter((s) => s.original && content.includes(s.original))
        .slice(0, 8)
        .map((s) => ({
          original: s.original as string,
          suggestion: s.suggestion ?? '',
          reason: s.reason ?? '',
        }));
    } catch (err) {
      console.error('[review] could not review content', {
        orgId,
        error: (err as Error)?.message,
      });
      return [];
    }
  }
}
