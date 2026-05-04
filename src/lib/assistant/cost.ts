// Anthropic pricing per million tokens for the models the assistant uses.
// Prices are USD per million tokens. 5-minute ephemeral cache.
// https://docs.anthropic.com/en/docs/about-claude/pricing
type ModelPricing = { input: number; output: number; cacheWrite5m: number; cacheRead: number };

const PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6":          { input: 3,    output: 15, cacheWrite5m: 3.75, cacheRead: 0.30 },
  "claude-opus-4-7":            { input: 15,   output: 75, cacheWrite5m: 18.75, cacheRead: 1.50 },
  "claude-haiku-4-5":           { input: 1,    output: 5,  cacheWrite5m: 1.25, cacheRead: 0.10 },
  "claude-haiku-4-5-20251001":  { input: 1,    output: 5,  cacheWrite5m: 1.25, cacheRead: 0.10 },
};

const FALLBACK = PRICING["claude-sonnet-4-6"];

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function priceForUsage(model: string, usage: AnthropicUsage): number {
  const p = PRICING[model] ?? FALLBACK;
  const cents =
    (usage.input_tokens ?? 0) * p.input +
    (usage.output_tokens ?? 0) * p.output +
    (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite5m +
    (usage.cache_read_input_tokens ?? 0) * p.cacheRead;
  return cents / 1_000_000;
}
