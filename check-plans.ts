import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

function buildPool() {
  const directUrl =
    process.env.POSTGRES_HOST && process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DATABASE
      ? `postgres://${process.env.POSTGRES_USER}:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@${process.env.POSTGRES_HOST}:5432/${process.env.POSTGRES_DATABASE}`
      : undefined;
  const raw = process.env.DATABASE_URL || directUrl;
  if (!raw) throw new Error("No database connection string found");
  const url = new URL(raw);
  url.searchParams.delete("sslmode");
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return new pg.Pool({
    connectionString: url.toString(),
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
}

const db = new PrismaClient({ adapter: new PrismaPg(buildPool()) });
async function main() {
  const plans = await db.weeklyPlan.findMany({ orderBy: { weekStart: 'desc' }, take: 5, select: { id: true, weekStart: true, status: true } });
  console.log('plans:', JSON.stringify(plans, null, 2));
  const slots = await db.weeklyPlanSlot.findMany({ orderBy: { day: 'desc' }, take: 10, select: { day: true, status: true } });
  console.log('recent slots:', JSON.stringify(slots, null, 2));
  await db.$disconnect();
}
main();
