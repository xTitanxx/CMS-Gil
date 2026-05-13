-- Enable RLS on every public table.
--
-- Why: Supabase exposes a PostgREST API at https://<ref>.supabase.co/rest/v1/* using
-- the anon key (shipped to every browser via NEXT_PUBLIC_SUPABASE_ANON_KEY). Without
-- RLS, the anon and authenticated roles have default SELECT/INSERT/UPDATE/DELETE/
-- TRUNCATE grants on every public table — i.e. anyone with the project URL could
-- read bcrypt subscriber hashes, chat messages, etc., and even truncate tables.
--
-- Prisma connects as the postgres superuser (POSTGRES_URL_NON_POOLING), which
-- bypasses RLS, so enabling RLS without policies is a safe deny-by-default for
-- anon/authenticated while leaving the app untouched.

ALTER TABLE public."Subscriber"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Subscriber"             FORCE ROW LEVEL SECURITY;
ALTER TABLE public."SubscriberConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SubscriberConversation" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."SubscriberMessage"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SubscriberMessage"      FORCE ROW LEVEL SECURITY;
ALTER TABLE public."SubscriberUsage"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SubscriberUsage"        FORCE ROW LEVEL SECURITY;
ALTER TABLE public."PostLike"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PostComment"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PostBookmark"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PushSubscription"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."_prisma_migrations"     ENABLE ROW LEVEL SECURITY;
