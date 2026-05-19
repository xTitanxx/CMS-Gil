// Touches Supabase's tracked API layer (PostgREST + Auth) so the project
// doesn't get auto-paused for inactivity. Prisma talks to Postgres directly
// through the pooler, which doesn't register on Supabase's "is this project
// active" heuristic — without this ping, free-tier projects pause after a
// week of API silence even when the DB is under load.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCron } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY" },
      { status: 500 },
    );
  }

  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
  };

  const [restRes, authRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/`, { headers }),
    fetch(`${supabaseUrl}/auth/v1/settings`, { headers }),
  ]);

  await prisma.$queryRaw`SELECT 1`;

  return NextResponse.json({
    ok: restRes.ok && authRes.ok,
    rest: restRes.status,
    auth: authRes.status,
    at: new Date().toISOString(),
  });
}
