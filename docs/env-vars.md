# Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Vercel + local | Supabase PostgreSQL |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | Vercel + local | NextAuth signing key |
| `GOOGLE_CLIENT_ID/SECRET` | Vercel + local | Google OAuth (auth + Drive + YouTube) |
| `AUTH_REDIRECT_PROXY_URL` | Vercel only | PKCE proxy for preview deployments |
| `AUTH_URL` / `NEXTAUTH_URL` | Local only | `http://localhost:3000` |
| `APP_URL` | Vercel + local | Base URL for OAuth redirect URIs |
| `R2_ENDPOINT` | Vercel + local | Cloudflare R2 S3 endpoint |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Vercel + local | R2 credentials |
| `R2_BUCKET_NAME` | Vercel + local | R2 bucket (defaults to `cms-gil-media`) |
| `R2_PUBLIC_URL` | Vercel + local | Public base URL for R2 (required) |
| `BLOB_READ_WRITE_TOKEN` | Vercel + local | Vercel Blob for ZIP staging |
| `ENCRYPTION_KEY` | Vercel + local | Encrypts platform OAuth tokens in DB |
| `ANTHROPIC_API_KEY` | Vercel + local | Claude API (tagging, chat, search, assistant) |
| `META_APP_ID/SECRET` | Vercel + local | Instagram + Facebook OAuth |
| `THREADS_APP_ID` | Vercel preview + production | Meta App ID for Threads (separate product within the same Meta app as FB/IG). |
| `THREADS_APP_SECRET` | Vercel preview + production | Threads app secret. Never commit. |
| `TIKTOK_CLIENT_KEY/SECRET` | Vercel + local | TikTok OAuth |
| `LINKEDIN_CLIENT_ID/SECRET` | Vercel + local | LinkedIn OAuth |
| `CRON_SECRET` | Vercel + local | Authenticates Vercel cron requests |
| `PUBLIC_GATE_ENABLED` | Vercel (per env) | When `"true"`, `proxy.ts` redirects unauthenticated visitors on `/`, `/p/*`, `/s/*`, `/chat` to `/welcome`. Off by default. Flipping false reopens the public site immediately. |
| `OWNER_USER_ID` / `GIL_USER_ID` | Vercel + local | Owner/content-author user IDs used by `/api/chat`'s post loader, `getPostContext`, and the public feed. **Without these, `/` returns 500.** |
