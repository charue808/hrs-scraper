import { DATABASE_URL } from "./config";

const schemaFile = Bun.file("sql/schema.sql");
const schemaSql = await schemaFile.text();

if (!DATABASE_URL) {
  console.log("No DATABASE_URL set. Printing SQL schema:\n");
  console.log(schemaSql);
  console.log("\nSet DATABASE_URL environment variable to run migration.");
  process.exit(0);
}

console.log("Running migration...");

const sql = new Bun.SQL(DATABASE_URL);

try {
  await sql.unsafe(schemaSql);
  console.log("Migration completed successfully.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await sql.close();
}
