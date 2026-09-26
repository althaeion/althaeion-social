import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { BrandService } from '@gitroom/nestjs-libraries/database/prisma/brand/brand.service';
import { AiUsageService } from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai.usage.service';
import { copyBudget, stripAiTypography } from '@gitroom/nestjs-libraries/openai/humanizer.prompt';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-proj-',
});

/**
 * The angles an ad can take.
 *
 * Asking a model for "10 ad variants" returns ten rewordings of one idea, which
 * tests nothing — they all win or lose together. Naming the angles forces the
 * set to differ where it matters, so a test result actually says something
 * about the message rather than the wording.
 */
export const AD_ANGLES = {
  problem: 'Lead with the pain the reader already feels. Name it in their words before offering anything.',
  benefit: 'Lead with the outcome. Concrete and measurable, never "improve your workflow".',
  social_proof: 'Lead with evidence that others already chose this. Numbers, names, or results.',
  curiosity: 'Open a loop worth closing. Never clickbait: the post must pay off the question it raises.',
  urgency: 'Give a real reason to act now. If there is no genuine deadline, use cost of delay instead of a fake timer.',
  objection: 'Name the reason they would say no, and answer it in the ad.',
} as const;

export const FUNNEL_STAGES = {
  top: 'They do not know the problem has a name yet. Teach, do not sell.',
  middle: 'They are comparing options. Show the difference, not the category.',
  bottom: 'They are ready. Remove the last friction and ask for the action.',
} as const;

export const AD_OBJECTIVES = [
  'awareness',
  'traffic',
  'leads',
  'sales',
  'app_installs',
  'retargeting',
] as const;

const AdSet = z.object({
  variants: z.array(
    z.object({
      platform: z.string(),
      angle: z.enum(Object.keys(AD_ANGLES) as [string, ...string[]]),
      stage: z.enum(['top', 'middle', 'bottom']),
      headline: z.string().describe('Under 60 characters. The single idea, not a summary.'),
      primary: z.string().describe('The body copy, written to the platform limit given.'),
      cta: z.string().describe('Two to four words. What they do next.'),
      hashtags: z.array(z.string()).describe('0-5, without the # sign. Empty array where hashtags do not belong.'),
      image_prompt: z
        .string()
        .describe('A prompt to generate the visual, describing subject, composition and mood. No text in the image.'),
      score: z
        .number()
        .describe('0-100: how strongly THIS variant serves the brief. Be honest, and spread the scores.'),
    })
  ),
});

@Injectable()
export class AdsGenerator {
  constructor(
    private _brandService: BrandService,
    private _aiUsageService: AiUsageService
  ) {}

  async generate(
    orgId: string,
    brief: {
      name: string;
      objective: string;
      product?: string | null;
      audience?: string | null;
      offer?: string | null;
      platforms: string[];
      angles?: string[];
      stages?: string[];
      perCombination?: number;
    }
  ) {
    const brand = await this._brandService.prompt(orgId);
    const angles = (brief.angles?.length ? brief.angles : Object.keys(AD_ANGLES)).filter(
      (a) => a in AD_ANGLES
    );
    const stages = (brief.stages?.length ? brief.stages : ['top', 'middle', 'bottom']).filter(
      (s) => s in FUNNEL_STAGES
    );
    const platforms = brief.platforms.length ? brief.platforms : ['linkedin'];

    // The matrix is capped: platforms x angles x stages grows fast, and a brief
    // that quietly asks for 200 variants is a bill, not a test.
    const perCombination = Math.min(2, Math.max(1, brief.perCombination || 1));
    const wanted = Math.min(60, platforms.length * angles.length * stages.length * perCombination);

    const budgets = platforms
      .map((p) => `- ${p}: hard cap ${copyBudget(p).hard} characters, aim for ${copyBudget(p).sweet}`)
      .join('\n');

    const angleList = angles.map((a) => `- ${a}: ${AD_ANGLES[a as keyof typeof AD_ANGLES]}`).join('\n');
    const stageList = stages
      .map((s) => `- ${s}: ${FUNNEL_STAGES[s as keyof typeof FUNNEL_STAGES]}`)
      .join('\n');

    const completion = await openai.chat.completions.parse({
      model: 'gpt-4.1',
      temperature: 0.8,
      messages: [
        {
          role: 'system',
          content:
            'You write direct-response social ads. You write like a person, not like a brochure.\n\n' +
            (brand ? `${brand}\n\n` : '') +
            `Produce EXACTLY ${wanted} variants covering the combinations below. Every variant must be a genuinely different argument, not a reworded one — if two variants would convince the same person for the same reason, replace one.\n\n` +
            `Angles:\n${angleList}\n\nFunnel stages:\n${stageList}\n\nPlatform limits:\n${budgets}\n\n` +
            'Rules: no em dashes or en dashes. No "unlock", "elevate", "game-changing", "revolutionary", "seamless". ' +
            'Never invent a statistic, a customer name, a price or a guarantee that the brief did not supply. ' +
            'If the brief is thin, write to what it says rather than filling the gap with plausible claims.',
        },
        {
          role: 'user',
          content: [
            `Campaign: ${brief.name}`,
            `Objective: ${brief.objective}`,
            brief.product ? `Product: ${brief.product}` : '',
            brief.audience ? `Audience: ${brief.audience}` : '',
            brief.offer ? `Offer: ${brief.offer}` : '',
            `Platforms: ${platforms.join(', ')}`,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      response_format: zodResponseFormat(AdSet, 'adSet'),
    });

    await this._aiUsageService.record(orgId, {
      kind: 'text',
      provider: 'openai',
      model: 'gpt-4.1',
      feature: 'ads_generate',
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
    });

    const variants = completion.choices[0].message.parsed?.variants || [];

    return variants
      .map((v) => ({
        platform: platforms.includes(v.platform) ? v.platform : platforms[0],
        angle: v.angle,
        stage: v.stage,
        headline: stripAiTypography(v.headline).slice(0, 120),
        primary: stripAiTypography(v.primary),
        cta: stripAiTypography(v.cta).slice(0, 40),
        hashtags: (v.hashtags || []).map((h) => h.replace(/^#/, '')).filter(Boolean).slice(0, 5),
        imagePrompt: v.image_prompt || null,
        score: Math.max(0, Math.min(100, Math.round(v.score ?? 0))),
      }))
      // Copy that overruns the platform cap is not a variant, it is a future
      // publish failure. Trimming mid-sentence would be worse, so it is dropped.
      .filter((v) => v.primary.length <= copyBudget(v.platform).hard)
      .sort((a, b) => b.score - a.score);
  }
}
