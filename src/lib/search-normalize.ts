/**
 * Normalizes text for search matching. Used on both the stored Post.body
 * (written to Post.bodyNormalized at write time) and the search term at
 * query time, so that typed-keyboard text matches Facebook's smart-punctuation
 * variants.
 *
 *   curly quotes  → straight quotes
 *   en/em dashes  → hyphen
 *   ellipsis char → "..."
 *   nbsp          → space
 *   zero-width    → removed (ZWSP, ZWNJ, ZWJ, BOM, soft hyphen)
 *   whitespace    → collapsed to single space (newlines, tabs, runs of spaces)
 *
 * Finally NFC-normalized, whitespace-collapsed, trimmed, and lowercased. The
 * whitespace collapse means a pasted phrase matches the stored body even when
 * the original spans a line break or has quirky spacing.
 */
export function normalizeForSearch(s: string): string {
  return s
    .normalize("NFC")
    .replace(/\u2026/g, "...")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
