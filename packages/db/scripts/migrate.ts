import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const DEFAULT_DATABASE_URL =
	"postgres://postgres:postgres@localhost:5432/alojamentoideal";

// Arbitrary but stable app-wide id; concurrent deploys (web + admin) queue on
// this session-level lock so only one applies pending migrations at a time.
const MIGRATION_ADVISORY_LOCK_ID = 4_128_662_001n;

const client = new Client({
	connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
});

await client.connect();
try {
	await client.query("select pg_advisory_lock($1)", [
		MIGRATION_ADVISORY_LOCK_ID.toString(),
	]);
	const db = drizzle(client);
	await migrate(db, {
		migrationsFolder: path.join(import.meta.dirname, "../drizzle"),
		migrationsSchema: "public",
		migrationsTable: "drizzle_migrations",
	});
	console.log("Migrations applied.");
} finally {
	await client.end();
}
