/**
 * The brand voice vocabulary.
 *
 * A free-text "tone" box produces mush: every brand types "professional yet
 * friendly" and every generation reads the same. A closed vocabulary grouped
 * into dimensions gives the model something it can actually act on, and gives
 * the UI something it can render as controls.
 *
 * Seven of the groups are SINGLE-SELECT because their values are mutually
 * exclusive opposites — a brand cannot be both formal and casual. `style` is
 * multi-select: those traits genuinely stack.
 */
export const BRAND_VOICE_GROUPS = {
  pov: ['first_person', 'second_person', 'third_person'],
  formality: ['formal', 'balanced', 'casual'],
  energy: ['calm', 'moderate', 'enthusiastic', 'vibrant'],
  humor: ['serious', 'dry', 'witty', 'playful'],
  attitude: ['respectful', 'even_handed', 'bold', 'provocative'],
  warmth: ['neutral', 'friendly', 'empathetic'],
  confidence: ['humble', 'confident', 'assertive'],
  style: [
    'direct',
    'concise',
    'transparent',
    'no_hype',
    'practical',
    'data_driven',
    'storytelling',
    'inspirational',
    'educational',
    'technical',
    'minimalist',
  ],
} as const;

export type BrandVoiceGroup = keyof typeof BRAND_VOICE_GROUPS;

export const SINGLE_SELECT_GROUPS: BrandVoiceGroup[] = [
  'pov',
  'formality',
  'energy',
  'humor',
  'attitude',
  'warmth',
  'confidence',
];

export const BRAND_VOICE_TRAITS: string[] = Object.values(BRAND_VOICE_GROUPS).flat();

const GROUP_OF: Record<string, BrandVoiceGroup> = Object.entries(BRAND_VOICE_GROUPS).reduce(
  (acc, [group, traits]) => {
    for (const trait of traits) {
      acc[trait] = group as BrandVoiceGroup;
    }
    return acc;
  },
  {} as Record<string, BrandVoiceGroup>
);

/**
 * Drop unknown traits, and keep only the FIRST trait per single-select group.
 * A model asked for "at most one per dimension" will still occasionally return
 * both `formal` and `casual`; letting that through means the prompt then asks
 * for two opposite things at once and the output drifts.
 */
export function normalizeVoiceTraits(traits: unknown): string[] {
  if (!Array.isArray(traits)) {
    return [];
  }

  const seenGroups = new Set<BrandVoiceGroup>();
  const out: string[] = [];

  for (const raw of traits) {
    const trait = String(raw || '').trim().toLowerCase();
    const group = GROUP_OF[trait];
    if (!group) continue;

    if (SINGLE_SELECT_GROUPS.includes(group)) {
      if (seenGroups.has(group)) continue;
      seenGroups.add(group);
    }

    if (!out.includes(trait)) {
      out.push(trait);
    }
  }

  return out;
}

/** `no_hype` reads as "no hype" to a model; the underscore does not help it. */
export function describeVoice(traits: string[]): string {
  return normalizeVoiceTraits(traits)
    .map((t) => t.replace(/_/g, ' '))
    .join(', ');
}
