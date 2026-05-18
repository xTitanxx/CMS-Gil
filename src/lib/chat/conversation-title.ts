// Derive a short title for a SubscriberConversation from its first user
// message. Used both at message-persist time (so the title is stored on the
// row) and as a runtime fallback when listing legacy conversations whose
// title column is still null.

const COST_TRAILER_STRIP_RE = /\n?​?__USAGE_USD:[0-9.]+__/g;
const POST_MARKER_STRIP_RE = /\[POST:\s*[^\s\]]+\s*\]/g;

export const CONVERSATION_TITLE_MAX_LEN = 50;

export function deriveTitleFromMessage(content: string): string | null {
  const cleaned = content
    .replace(COST_TRAILER_STRIP_RE, "")
    .replace(POST_MARKER_STRIP_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length <= CONVERSATION_TITLE_MAX_LEN) return cleaned;
  return cleaned.slice(0, CONVERSATION_TITLE_MAX_LEN).trimEnd() + "…";
}
