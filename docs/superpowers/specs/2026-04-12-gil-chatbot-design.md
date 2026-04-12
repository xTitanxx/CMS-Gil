# Gil Chatbot — Design Spec

## Overview

Transform the existing `/chat` route from an internal content-search tool into a public-facing chatbot where fans and followers can converse with an AI reincarnation of Gil. Gil responds as a thoughtful mentor, strictly grounded in his actual posts about MS, breathwork, depression, and other lived experiences.

## Architecture

### Route Changes

- **`/chat`** becomes a public page — no auth required
- **`/api/chat`** becomes a public endpoint — no session check
- `/chat` gets its own **standalone layout** outside the dashboard (no sidebar, no auth gate)
- The existing dashboard layout and all other routes remain behind auth

### Post Context Loading

- Posts are loaded using a **hardcoded Gil user ID** stored as the env var `GIL_USER_ID`
- Load the 500 most recent posts (body, tags, originalDate) — same query as today
- **Cache the formatted post blob in-memory** (module-level variable with 1-hour TTL) to avoid hitting the DB on every message
- Cache invalidation: simple time-based expiry; no need for event-driven invalidation now

### AI Model & Persona

**Model:** Claude Haiku 4.5 (`claude-haiku-4-5`)

**System Prompt Design:**

The system prompt establishes Gil as:
- A thoughtful, reflective mentor who speaks from personal lived experience
- Strictly grounded in his posts — he only discusses topics he's actually written about
- When asked about something not covered in his posts, he responds warmly: "I haven't shared my thoughts on that yet, but I appreciate you asking"
- Not a medical professional — he shares his personal experience, not advice
- Concise and conversational — responds like a messenger chat, not essays

The system prompt includes:
- Gil's persona description and behavioral rules
- The full cached post context (body + tags + date for each post)
- Instruction to reference specific posts when relevant (quote snippets so users can recognize them)

### Rate Limiting

- **IP-based** using an in-memory `Map` with sliding window
- **Default limit:** 20 messages per hour per IP
- On `429 Too Many Requests`, return a friendly message:
  > "Hey, thanks so much for chatting with me! I'm still in early development and can only handle a limited number of messages right now. Please come back in a bit — I'd love to continue our conversation. This will get better over time!"
- Resets on deploy/cold start (acceptable for now)
- Configurable via constants for easy adjustment

### Conversation History

- Conversation is **client-side only** (same as today) — stored in React state
- Full message history sent with each request for context continuity
- No server-side persistence of conversations (privacy-friendly, simpler)
- Conversations reset on page refresh

## UI Design

### Layout

- **Standalone page** — no sidebar, no dashboard chrome
- Messenger-style: narrow centered chat column (max-width ~600px), works great on mobile and desktop
- **Chat header:** Gil's name and small avatar at the top (like a Messenger/WhatsApp conversation header)
- Clean, minimal — the conversation is the entire experience

### Messages

- **Gil's messages:** Left-aligned chat bubbles with Gil's avatar
- **User's messages:** Right-aligned chat bubbles (different color)
- Streaming indicator while Gil is "typing"
- Auto-scroll to latest message

### Empty State

Fan-oriented placeholder suggestions instead of the current internal ones:
- "What's your experience with breathwork?"
- "How do you deal with tough days?"
- "Tell me about your MS journey"
- "What helps you with depression?"

### Styling

- Clean, modern messenger aesthetic
- Mobile-first responsive design
- Warm color palette appropriate for the personal/wellness context

## Environment Variables

| Variable | Purpose |
|---|---|
| `GIL_USER_ID` | Hardcoded user ID for loading Gil's posts without auth |

## Future Considerations

- **Subscription/monetization:** Rate limiting infrastructure can be extended to check subscription status once a paid tier is introduced
- **RAG:** When post volume or traffic grows, switch from loading all posts to embedding-based retrieval for the most relevant 10-20 posts per question — dramatically cuts token cost
- **Public post archive:** The post archive will also become public at some point; the chatbot and archive are two faces of the same public content
- **Persona evolution:** The system prompt can be loosened from "strictly post-grounded" to "post-informed but conversational" with a simple prompt change
- **gilalter.com split:** Eventually the public routes (`/chat`, post archive) live at `gilalter.com` and the admin CMS moves behind `gilalter.com/admin`
