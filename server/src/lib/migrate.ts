import fs from "fs";
import path from "path";
import { pool } from "../db";

// Brings the database up to date with db/migrations.sql (see the comment at the top of that file).
// Runs when the server starts, so a new version on Render updates the hosted database by itself.
export async function runMigrations(): Promise<void> {
  const file = path.join(__dirname, "..", "..", "db", "migrations.sql");
  await pool.query(fs.readFileSync(file, "utf8"));
}
