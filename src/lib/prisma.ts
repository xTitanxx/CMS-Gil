import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  // Prefer DATABASE_URL (manually set on Vercel), then POSTGRES_URL (Supabase
  // pooler on port 6543, works everywhere), then a direct URL assembled from
  // individual POSTGRES_* vars as last resort.
  const directUrl =
    process.env.POSTGRES_HOST && process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DATABASE
      ? `postgres://${process.env.POSTGRES_USER}:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@${process.env.POSTGRES_HOST}:5432/${process.env.POSTGRES_DATABASE}`
      : undefined;
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || directUrl;
  if (!connectionString) throw new Error("No database connection string found (DATABASE_URL or POSTGRES_HOST/USER/PASSWORD/DATABASE)");
  // Strip sslmode from the URL — newer pg versions map sslmode=require to
  // verify-full which rejects Supabase's self-signed cert chain, overriding
  // the explicit ssl config below.
  const cleanUrl = new URL(connectionString);
  cleanUrl.searchParams.delete("sslmode");
  cleanUrl.searchParams.delete("supa");
  cleanUrl.searchParams.delete("pgbouncer");
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

// Lazy proxy: defer createPrismaClient() until something actually reads a
// property on the export. Two reasons:
//   1. Importing this module from a unit test that mocks @/lib/prisma should
//      never hit createPrismaClient — but vitest's module load still touches
//      the export when the source file under test imports it. With eager
//      init, every test run without DATABASE_URL set throws at module load.
//   2. Lets transitively-imported modules in build/typecheck contexts not
//      require a connection string.
function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getClient(), prop, receiver);
  },
}) as PrismaClient;
