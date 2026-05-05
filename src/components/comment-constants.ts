// Kept in a server-safe module so CommentComposer (client) can import it
// without dragging in the prisma client.
export const COMMENT_BODY_MAX = 2000;
