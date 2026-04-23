import pg from "pg";

function getConnectionString() {
  const directUrl =
    process.env.POSTGRES_HOST && process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DATABASE
      ? `postgres://${process.env.POSTGRES_USER}:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@${process.env.POSTGRES_HOST}:5432/${process.env.POSTGRES_DATABASE}`
      : undefined;
  const raw = process.env.DATABASE_URL || directUrl;
  if (!raw) throw new Error("No database connection string found");
  const url = new URL(raw);
  url.searchParams.delete("sslmode");
  return url.toString();
}

const connStr = getConnectionString();
const isLocal = new URL(connStr).hostname === "localhost" || new URL(connStr).hostname === "127.0.0.1";
const pool = new pg.Pool({
  connectionString: connStr,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

const res = await pool.query(`
  INSERT INTO "User" (id, name, email)
  VALUES ('cmnala41x000004lgj4riwp83', 'Gil', NULL)
  ON CONFLICT (id) DO NOTHING
  RETURNING id, name
`);
console.log("inserted:", res.rows.length ? res.rows[0] : "already exists");
await pool.end();
