import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { schema } from "./schema";

const DEFAULT_DATABASE_URL =
	"postgres://postgres:postgres@localhost:5432/alojamentoideal";
const DEFAULT_POOL_MAX = 10;
const DEFAULT_BUILD_POOL_MAX = 1;
const NEXT_PRODUCTION_BUILD_PHASE = "phase-production-build";

let pool: Pool | undefined;
let database: ReturnType<typeof createDatabase> | undefined;

function createDatabase(connectionPool: Pool) {
	return drizzle(connectionPool, { schema });
}

function readPositiveInteger(name: string): number | undefined {
	const raw = process.env[name];
	if (!raw) return undefined;

	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${name} must be a positive integer`);
	}

	return parsed;
}

function isProductionBuild(): boolean {
	return process.env.NEXT_PHASE === NEXT_PRODUCTION_BUILD_PHASE;
}

function getPoolConfig(): PoolConfig {
	const isBuild = isProductionBuild();
	const max =
		(isBuild ? readPositiveInteger("DATABASE_BUILD_POOL_MAX") : undefined) ??
		readPositiveInteger("DATABASE_POOL_MAX") ??
		(isBuild ? DEFAULT_BUILD_POOL_MAX : DEFAULT_POOL_MAX);

	return {
		allowExitOnIdle: isBuild,
		connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
		connectionTimeoutMillis: 5000,
		max,
	};
}

/** Lazily created singleton pool, so importing the module never opens a socket. */
export function getPool(): Pool {
	if (!pool) {
		pool = new Pool(getPoolConfig());
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
