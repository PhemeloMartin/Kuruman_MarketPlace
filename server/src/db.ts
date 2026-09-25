import { Pool } from "pg";
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Did you create server/.env from .env.example?");
}

// One shared connection pool for the whole app.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Hosted databases need SSL; your local one does not.
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
