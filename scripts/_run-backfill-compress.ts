// Tiny launcher that loads .env.local then defers to the real backfill.
// Standalone so the user's "no shell expansions" rule can be honored without
// the inline `set -a && source` dance.
import { config } from "dotenv";
config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.POSTGRES_URL_NON_POOLING;
}
import("./backfill-compress-videos");
