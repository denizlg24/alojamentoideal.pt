import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { schema } from "./schema";

const DEFAULT_DATABASE_URL =
	"postgres://postgres:postgres@localhost:5432/alojamentoideal";

let pool: Pool | undefined;
let database: ReturnType<typeof createDatabase> | undefined;

function createDatabase(connectionPool: Pool) {
	return drizzle(connectionPool, { schema });
}

/** Lazily created singleton pool, so importing the module never opens a socket. */
export function getPool(): Pool {
	if (!pool) {
		pool = new Pool({
			connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
			connectionTimeoutMillis: 5000,
		});
	}

	return pool;
}

export function getDb() {
	if (!database) {
		database = createDatabase(getPool());
	}

	return database;
}

export type Database = ReturnType<typeof getDb>;
