import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  // Parse the connection string manually so the ssl config is never overridden
  // by sslmode query params (pg library can conflict when both are present).
  // Production: DATABASE_URL (set manually in Vercel).
  // Local dev: Supabase Vercel integration injects POSTGRES_* vars but the
  // pooler hostname (aws-1-us-east-1.pooler.supabase.com) uses IPv6 and is
  // unreachable from most local networks. Fall back to the direct host
  // (db.<ref>.supabase.co) assembled from the individual POSTGRES_* vars.
  const directUrl =
    process.env.POSTGRES_HOST && process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DATABASE
      ? `postgres://${process.env.POSTGRES_USER}:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@${process.env.POSTGRES_HOST}:5432/${process.env.POSTGRES_DATABASE}`
      : undefined;
  const connectionString = process.env.DATABASE_URL || directUrl;
  if (!connectionString) throw new Error("No database connection string found (DATABASE_URL or POSTGRES_HOST/USER/PASSWORD/DATABASE)");
  // Strip sslmode from the URL — newer pg versions map sslmode=require to
  // verify-full which rejects Supabase's self-signed cert chain, overriding
  // the explicit ssl config below.
  const cleanUrl = new URL(connectionString);
  cleanUrl.searchParams.delete("sslmode");
  const isLocalhost = cleanUrl.hostname === "localhost" || cleanUrl.hostname === "127.0.0.1";
  const pool = new pg.Pool({
    connectionString: cleanUrl.toString(),
    ssl: isLocalhost ? false : { rejectUnauthorized: false },
    max: 10,                       // posts API fires 9+ parallel queries
    idleTimeoutMillis: 0,          // never drop idle connections
    connectionTimeoutMillis: 15000, // fail fast instead of 30s default
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
