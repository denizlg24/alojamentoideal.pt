import { optionalInteger, optionalString } from "../internal/env";

export interface RedisConfig {
	commandTimeoutMs: number;
	connectTimeoutMs: number;
	keyPrefix: string;
	maxRetriesPerRequest: number;
	url: string;
}

interface RedisEnvironment {
	REDIS_COMMAND_TIMEOUT_MS?: string;
	REDIS_CONNECT_TIMEOUT_MS?: string;
	REDIS_KEY_PREFIX?: string;
	REDIS_MAX_RETRIES_PER_REQUEST?: string;
	REDIS_URL?: string;
}

const DEFAULT_REDIS_URL = "redis://localhost:6379";

export function getRedisConfig(
	environment: RedisEnvironment = {
		REDIS_COMMAND_TIMEOUT_MS: process.env.REDIS_COMMAND_TIMEOUT_MS,
		REDIS_CONNECT_TIMEOUT_MS: process.env.REDIS_CONNECT_TIMEOUT_MS,
		REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX,
		REDIS_MAX_RETRIES_PER_REQUEST: process.env.REDIS_MAX_RETRIES_PER_REQUEST,
		REDIS_URL: process.env.REDIS_URL,
	},
): RedisConfig {
	return {
		commandTimeoutMs: optionalInteger(
			"REDIS_COMMAND_TIMEOUT_MS",
			environment.REDIS_COMMAND_TIMEOUT_MS,
			100,
			60_000,
			5_000,
		),
		connectTimeoutMs: optionalInteger(
			"REDIS_CONNECT_TIMEOUT_MS",
			environment.REDIS_CONNECT_TIMEOUT_MS,
			100,
			60_000,
			10_000,
		),
		keyPrefix:
			optionalString(environment.REDIS_KEY_PREFIX) ?? "alojamentoideal",
		maxRetriesPerRequest: optionalInteger(
			"REDIS_MAX_RETRIES_PER_REQUEST",
			environment.REDIS_MAX_RETRIES_PER_REQUEST,
			0,
			20,
			2,
		),
		url: optionalString(environment.REDIS_URL) ?? DEFAULT_REDIS_URL,
	};
}
