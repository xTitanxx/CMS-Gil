// Anthropic pricing per million tokens for the models the assistant uses.
// 1h cache writes cost more than 5m writes (1.6x for Sonnet/Haiku, ~1.6x for
// Opus); cache reads are the same rate regardless of TTL.
// https://docs.anthropic.com/en/docs/about-claude/pricing
type ModelPricing = {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
};

const PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6":          { input: 3,    output: 15, cacheWrite5m: 3.75,  cacheWrite1h: 6.00,  cacheRead: 0.30 },
  "claude-opus-4-7":            { input: 15,   output: 75, cacheWrite5m: 18.75, cacheWrite1h: 30.00, cacheRead: 1.50 },
  "claude-haiku-4-5":           { input: 1,    output: 5,  cacheWrite5m: 1.25,  cacheWrite1h: 2.00,  cacheRead: 0.10 },
  "claude-haiku-4-5-20251001":  { input: 1,    output: 5,  cacheWrite5m: 1.25,  cacheWrite1h: 2.00,  cacheRead: 0.10 },
};

const FALLBACK = PRICING["claude-sonnet-4-6"];

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  // Optional 5m/1h breakdown. When provided, billed at the matching rate;
  // otherwise the legacy aggregate cache_creation_input_tokens is billed at
  // the 5m rate (under-counts for 1h-cached prompts but matches old logs).
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
}

export function priceForUsage(model: string, usage: AnthropicUsage): number {
  const p = PRICING[model] ?? FALLBACK;
  const breakdown = usage.cache_creation;
  const write5m = breakdown?.ephemeral_5m_input_tokens ?? null;
  const write1h = breakdown?.ephemeral_1h_input_tokens ?? null;
  const cacheWriteCost =
    write5m != null || write1h != null
      ? (write5m ?? 0) * p.cacheWrite5m + (write1h ?? 0) * p.cacheWrite1h
      : (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite5m;
  const cents =
    (usage.input_tokens ?? 0) * p.input +
    (usage.output_tokens ?? 0) * p.output +
    cacheWriteCost +
    (usage.cache_read_input_tokens ?? 0) * p.cacheRead;
  return cents / 1_000_000;
}
