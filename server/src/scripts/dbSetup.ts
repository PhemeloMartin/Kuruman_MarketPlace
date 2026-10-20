import fs from "fs";
import path from "path";
import { pool } from "../db";
import { describeError } from "../lib/describeError";

// Creates (or re-creates) every table from db/schema.sql.
// WARNING: this deletes all existing data. Use it in development only.
async function main() {
  const schemaPath = path.join(__dirname, "..", "..", "db", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
  console.log("Database tables created successfully.");
}

main()
  .catch((err) => {
    console.error("Database setup failed:", describeError(err));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
