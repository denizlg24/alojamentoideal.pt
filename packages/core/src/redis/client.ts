import Redis, { type RedisOptions } from "ioredis";
import { getRedisConfig } from "./config";

let client: Redis | undefined;

function buildOptions(): RedisOptions {
	const config = getRedisConfig();
	const keyPrefix = config.keyPrefix.endsWith(":")
		? config.keyPrefix
		: `${config.keyPrefix}:`;

	return {
		commandTimeout: config.commandTimeoutMs,
		connectTimeout: config.connectTimeoutMs,
		// Fail fast instead of buffering commands while disconnected, so callers
		// (rate limiter, cache) can fall back gracefully rather than hang.
		enableOfflineQueue: false,
		keyPrefix,
		lazyConnect: true,
		maxRetriesPerRequest: config.maxRetriesPerRequest,
		retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
	};
}

/**
 * Lazily created singleton ioredis client. Importing this module never opens a
 * socket; the connection is established on first command (lazyConnect). Errors
 * are logged rather than thrown so a Redis outage degrades features instead of
 * crashing the process.
 */
export function getRedis(): Redis {
	if (!client) {
		const config = getRedisConfig();
		client = new Redis(config.url, buildOptions());
		client.on("error", (error: Error) => {
			console.error("[redis] connection error", error.message);
		});
	}

	return client;
}

/** Best-effort connectivity probe used by health checks. */
export async function pingRedis(): Promise<boolean> {
	try {
		const response = await getRedis().ping();
		return response === "PONG";
	} catch {
		return false;
	}
}

/** Closes the singleton connection. Intended for tests and graceful shutdown. */
export async function closeRedis(): Promise<void> {
	if (client) {
		await client.quit().catch(() => undefined);
		client = undefined;
	}
}
