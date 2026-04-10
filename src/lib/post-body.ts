const SYNTHETIC_EMPTY = new Set(["(no text)", "(no_text)"]);

export function displayBody(body: string | null | undefined): string {
  if (!body) return "";
  const trimmed = body.trim();
  if (SYNTHETIC_EMPTY.has(trimmed.toLowerCase())) return "";
  return body;
}
