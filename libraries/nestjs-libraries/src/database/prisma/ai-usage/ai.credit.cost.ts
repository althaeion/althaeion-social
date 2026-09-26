/**
 * What an AI call costs in credits.
 *
 * Postiz already had a `Credits` balance but nothing that priced a call, so
 * every generation cost the same whatever it actually consumed — a one-line
 * caption and an HD image both took a flat deduction. These rates are the ones
 * TryPost bills on, kept as a table so a model price change is one edit here
 * rather than a hunt through the generators.
 */
export const AI_CREDIT_COST = {
  text: {
    /** 1 credit = this many tokens, input + output summed. */
    tokensPerCredit: 150,
  },
  image: {
    /** Credits per image, keyed by model id; `default` covers anything unlisted. */
    default: 50,
    'gpt-image-1.5': 50,
    'gpt-image-1.5-hd': 100,
    // gpt-image-2 is called at quality=low (~$0.01/image at 1024²). If medium or
    // high is ever exposed, add gpt-image-2-medium / -hd rather than raising this.
    'gpt-image-2': 15,
    'flux-pro': 30,
    'dall-e-3': 50,
  } as Record<string, number>,
  video: {
    default: 500,
  } as Record<string, number>,
};

export type AiUsageKind = 'text' | 'image' | 'video';

/**
 * Credits for one call. Text is metered on tokens and always costs at least 1 —
 * a 40-token call that rounded to 0 would be free to repeat in a loop.
 */
export function creditsForUsage(input: {
  kind: AiUsageKind;
  model?: string | null;
  totalTokens?: number;
  quantity?: number;
}): number {
  const quantity = Math.max(1, input.quantity ?? 1);

  if (input.kind === 'text') {
    const tokens = Math.max(0, input.totalTokens ?? 0);
    if (tokens === 0) {
      return 0;
    }
    return Math.max(1, Math.ceil(tokens / AI_CREDIT_COST.text.tokensPerCredit));
  }

  const table = input.kind === 'image' ? AI_CREDIT_COST.image : AI_CREDIT_COST.video;
  const rate = (input.model && table[input.model]) || table.default;

  return rate * quantity;
}
