/**
 * The AI-tell list.
 *
 * This is the substance of the humanizer: a catalogue of the specific patterns
 * that make generated copy readable as generated. It is kept as data rather
 * than buried in a service so it can be read, argued with, and extended without
 * touching the call site.
 */
export const HUMANIZER_RULES = `## What to remove (AI-tells)

**Promotional / inflated language:**
testament, pivotal moment, evolving landscape, vital/crucial/key role, in the heart of, nestled, groundbreaking, breathtaking, must-visit, stunning, vibrant, rich (figurative), profound, exemplifies, commitment to.

**Empty filler verbs (-ing endings):**
highlighting, underscoring, emphasizing, ensuring, reflecting, symbolizing, contributing to, fostering, encompassing, showcasing.

**Overused AI vocabulary:**
delve, additionally, align with, crucial, enduring, enhance, garner, interplay, intricate, key (adj), landscape (abstract), pivotal, showcase, tapestry, testament, underscore, vibrant.

**Copula avoidance:**
"serves as", "stands as", "marks", "represents [a]", "boasts", "features [a]" — replace with simple "is/are/has".

**Negative parallelism:**
"It's not just X, it's Y", "Not only A, but also B" — overused. Just say what it is.

**Tailing negation fragments:**
"...no guessing", "...no wasted motion" — make it a real clause.

**Rule of three overuse:**
LLMs force ideas into groups of three. If three items don't add value, use one or two.

**Elegant variation (synonym cycling):**
"protagonist / main character / central figure / hero" all in one paragraph — pick one and stick with it.

**False ranges:**
"from X to Y" where X and Y aren't on a meaningful scale — just list them.

**Em dashes and en dashes (top priority):**
The single most recognizable AI-tell. Remove EVERY one. Rewrite with a comma, parentheses, a colon, or split into two sentences. Regular hyphens in compound words (e.g. "e-mail") are fine. The final output must contain zero em dash and en dash characters.

**Curly quotes:**
Replace curly quotes and apostrophes with straight " and '.

**Sycophantic / chatbot artifacts:**
"Great question!", "Of course!", "I hope this helps", "Let me know if...", "Without further ado", "Let's dive in".

**Knowledge-cutoff disclaimers:**
"While specific details are limited...", "based on available information..." — drop entirely.

**Excessive hedging:**
"could potentially possibly", "might have some effect" — pick one modal or none.

**Generic positive conclusions:**
"the future looks bright", "exciting times lie ahead", "a journey toward excellence" — drop or replace with a concrete next step.

**Hyphen overuse:**
"third-party", "cross-functional", "data-driven", "real-time" — humans rarely hyphenate these uniformly. Drop the hyphen unless it actually changes meaning.

**Persuasive authority tropes:**
"The real question is...", "At its core...", "Fundamentally..." — drop the framing.

**Signposting:**
"Let's break this down", "Here's what you need to know" — just say it.

## How to rewrite

1. **Vary rhythm.** Mix short and long sentences. Don't make every sentence the same shape.
2. **Have a point of view.** Real humans react. Neutral reporting reads like a wiki.
3. **Be specific.** Replace abstractions with concrete details when possible.
4. **Use "is/are/has"** where AI-elaborate constructions appear.
5. **Cut filler.** "In order to" -> "to". "Due to the fact that" -> "because". "At this point in time" -> "now".
6. **Match the brand voice.** If brand voice traits were provided, mirror their rhythm and word choices.
7. **Preserve meaning.** The core message and any specific facts/numbers/claims stay intact.
8. **Match the original length roughly.** Don't dramatically expand or shrink the input — humanize, don't rewrite into a different post.`;

export const HUMANIZER_FINAL_CHECK = `FINAL CHECK before replying: scan every text field of your output for em dash and en dash characters. If even one remains, rewrite that sentence using a comma, parentheses, a colon, or two separate sentences, until none are left. A response that still contains one is a failed response. Return your answer only after zero remain.`;

/**
 * Per-network character budgets.
 *
 * The generator writes inside the platform's cap, so a rewrite that ignores it
 * can push the post over a limit the first pass respected — the failure then
 * surfaces at publish time, long after the user approved the text.
 */
export const PLATFORM_COPY_BUDGET: Record<string, { hard: number; sweet: number }> = {
  x: { hard: 280, sweet: 200 },
  mastodon: { hard: 500, sweet: 350 },
  bluesky: { hard: 300, sweet: 220 },
  threads: { hard: 500, sweet: 350 },
  instagram: { hard: 2200, sweet: 900 },
  facebook: { hard: 63206, sweet: 800 },
  linkedin: { hard: 3000, sweet: 1200 },
  'linkedin-page': { hard: 3000, sweet: 1200 },
  pinterest: { hard: 500, sweet: 300 },
  tiktok: { hard: 2200, sweet: 700 },
  youtube: { hard: 5000, sweet: 1000 },
  telegram: { hard: 4096, sweet: 800 },
  discord: { hard: 2000, sweet: 600 },
  reddit: { hard: 40000, sweet: 1500 },
  default: { hard: 2200, sweet: 800 },
};

export function copyBudget(platform?: string | null) {
  return PLATFORM_COPY_BUDGET[(platform || '').toLowerCase()] || PLATFORM_COPY_BUDGET.default;
}

/** The dashes the rules ban, so the check is one list rather than three literals. */
const BANNED_DASHES = /[—–]/g;
const CURLY = /[‘’“”]/g;

/**
 * A deterministic last line of defence.
 *
 * Models comply with "remove every em dash" most of the time, and the rule
 * calls a leftover a failed response — but shipping a failed response to the
 * user is worse than fixing it here. Replacing the dash with a comma is the
 * substitution the prompt itself asks for first.
 */
export function stripAiTypography(text: string): string {
  return (text || '')
    .replace(BANNED_DASHES, ',')
    .replace(CURLY, (m) => (m === '‘' || m === '’' ? "'" : '"'))
    // A dash swapped for a comma next to existing punctuation leaves ", ," behind.
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/,(\S)/g, ', $1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
