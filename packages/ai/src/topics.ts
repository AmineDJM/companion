/**
 * Question topic clustering.
 *
 * Analytics pages never call a model. Questions are assigned to a topic at ask
 * time by a cheap keyword classifier, and a background job periodically
 * refines labels and writes the "what people want to know" insight. Clusters
 * update incrementally, so cost stays negligible however many questions arrive.
 */

export interface TopicSeed {
  slug: string;
  label: string;
  patterns: RegExp[];
}

/** Seed themes that cover the overwhelming majority of B2B document questions. */
export const TOPIC_SEEDS: TopicSeed[] = [
  {
    slug: 'pricing',
    label: 'Pricing',
    patterns: [
      /\b(pric|cost|fee|rate|budget|quote|discount|tarif|how much|payment terms?|invoic|billing)\b/i,
      /\b(per (?:seat|user|month|year)|licen[cs]e cost)\b/i,
    ],
  },
  {
    slug: 'implementation',
    label: 'Implementation',
    patterns: [
      /\b(implement|onboard|rollout|roll[- ]out|deploy|migrat|setup|set up|go[- ]live|integration|timeline|how long|lead time|delivery date|deadline|schedule)\b/i,
    ],
  },
  {
    slug: 'security',
    label: 'Security',
    patterns: [
      /\b(security|secure|encrypt|gdpr|iso ?27001|soc ?2|compliance|data protection|privacy|breach|penetration test|vulnerab|access control|hosting location|data residency)\b/i,
    ],
  },
  {
    slug: 'contract',
    label: 'Contract terms',
    patterns: [
      /\b(contract|agreement|terms?|clause|termination|notice period|renew|liability|indemnit|warrant|sla|penalt|exit|cancel|obligation|governing law|jurisdiction)\b/i,
    ],
  },
  {
    slug: 'financials',
    label: 'Financials',
    patterns: [
      /\b(revenue|arr|mrr|ebitda|margin|forecast|projection|cash ?flow|burn|runway|valuation|p&l|profit|loss|balance sheet|financial model|assumption)\b/i,
    ],
  },
  {
    slug: 'product',
    label: 'Product & features',
    patterns: [
      /\b(feature|function|capabilit|roadmap|support(?:s|ed)?|does it|can it|api|integrat|limitation|scope|module|workflow)\b/i,
    ],
  },
  {
    slug: 'team',
    label: 'Team & organisation',
    patterns: [
      /\b(team|founder|headcount|employee|hiring|organi[sz]ation|who is|experience|background|reference|customer)\b/i,
    ],
  },
  {
    slug: 'support',
    label: 'Support & service',
    patterns: [
      /\b(support|help ?desk|response time|availability|uptime|maintenance|training|documentation|account manager)\b/i,
    ],
  },
];

export interface TopicAssignment {
  slug: string;
  label: string;
  confidence: number;
}

/**
 * Assigns a question to a theme. Returns a derived topic from the question's
 * own keywords when no seed matches, so the analytics page shows what people
 * actually ask rather than an "Other" bucket.
 */
export function assignTopic(question: string): TopicAssignment {
  const normalized = question.trim();
  let best: { seed: TopicSeed; hits: number } | null = null;

  for (const seed of TOPIC_SEEDS) {
    const hits = seed.patterns.reduce((count, pattern) => count + (pattern.test(normalized) ? 1 : 0), 0);
    if (hits > 0 && (!best || hits > best.hits)) best = { seed, hits };
  }

  if (best) {
    return {
      slug: best.seed.slug,
      label: best.seed.label,
      confidence: Math.min(0.55 + best.hits * 0.2, 0.95),
    };
  }

  const derived = deriveTopic(normalized);
  return { slug: derived.slug, label: derived.label, confidence: 0.3 };
}

const GENERIC_WORDS = new Set([
  'about', 'after', 'again', 'also', 'any', 'anything', 'are', 'because', 'been', 'before', 'being',
  'between', 'both', 'can', 'could', 'did', 'does', 'doing', 'done', 'each', 'explain', 'find',
  'from', 'give', 'has', 'have', 'here', 'how', 'into', 'its', 'just', 'know', 'like', 'make',
  'many', 'more', 'most', 'much', 'need', 'not', 'now', 'only', 'other', 'our', 'out', 'over',
  'please', 'said', 'same', 'say', 'see', 'should', 'show', 'some', 'such', 'tell', 'than', 'that',
  'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'time',
  'under', 'use', 'used', 'using', 'very', 'want', 'was', 'way', 'were', 'what', 'when', 'where',
  'which', 'while', 'who', 'why', 'will', 'with', 'would', 'you', 'your', 'document', 'documents',
  'file', 'files', 'page', 'pages',
]);

function deriveTopic(question: string): { slug: string; label: string } {
  const words = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((word) => word.length > 3 && !GENERIC_WORDS.has(word));

  if (words.length === 0) return { slug: 'general', label: 'General' };
  const head = words.slice(0, 2);
  const label = head.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  return { slug: head.join('-').slice(0, 60), label: label.slice(0, 60) };
}

/**
 * Builds the human sentence shown under "Unanswered" when a theme is asked
 * about often but the documents do not cover it well.
 */
export function unansweredInsight(input: {
  label: string;
  questionCount: number;
  unansweredCount: number;
  exampleQuestions: string[];
}): string | null {
  if (input.unansweredCount < 2) return null;
  const ratio = input.unansweredCount / Math.max(input.questionCount, 1);
  if (ratio < 0.3) return null;

  const example = input.exampleQuestions[0];
  const theme = input.label.toLowerCase();
  if (ratio >= 0.7) {
    return `${capitalise(theme)} is asked about regularly but is not covered by the uploaded material${
      example ? ` — for example, "${truncate(example, 120)}"` : ''
    }.`;
  }
  return `${capitalise(theme)} is frequently requested but is not clearly explained in the uploaded material.`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}
