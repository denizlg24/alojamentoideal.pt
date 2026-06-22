import { optionalBoolean, optionalInteger } from "../internal/env";

export type RateLimitBucket =
	| "default"
	| "auth"
	| "cron"
	| "mutation"
	| "cart.read"
	| "cart.write"
	| "checkout.write";

export interface RateLimitBucketConfig {
	/** Seconds a key stays blocked after exhausting its points. */
	blockDurationSeconds: number;
	/** Sliding window length in seconds. */
	durationSeconds: number;
	/** Allowed requests per window. */
	points: number;
}

export interface RateLimitConfig {
	buckets: Record<RateLimitBucket, RateLimitBucketConfig>;
	enabled: boolean;
}

interface RateLimitEnvironment {
	RATE_LIMIT_AUTH_POINTS?: string;
	RATE_LIMIT_AUTH_WINDOW_SECONDS?: string;
	RATE_LIMIT_CART_READ_POINTS?: string;
	RATE_LIMIT_CART_READ_WINDOW_SECONDS?: string;
	RATE_LIMIT_CART_WRITE_POINTS?: string;
	RATE_LIMIT_CART_WRITE_WINDOW_SECONDS?: string;
	RATE_LIMIT_CHECKOUT_WRITE_POINTS?: string;
	RATE_LIMIT_CHECKOUT_WRITE_WINDOW_SECONDS?: string;
	RATE_LIMIT_CRON_POINTS?: string;
	RATE_LIMIT_CRON_WINDOW_SECONDS?: string;
	RATE_LIMIT_DEFAULT_POINTS?: string;
	RATE_LIMIT_DEFAULT_WINDOW_SECONDS?: string;
	RATE_LIMIT_ENABLED?: string;
	RATE_LIMIT_MUTATION_POINTS?: string;
	RATE_LIMIT_MUTATION_WINDOW_SECONDS?: string;
}

function readEnvironment(): RateLimitEnvironment {
	return {
		RATE_LIMIT_AUTH_POINTS: process.env.RATE_LIMIT_AUTH_POINTS,
		RATE_LIMIT_AUTH_WINDOW_SECONDS: process.env.RATE_LIMIT_AUTH_WINDOW_SECONDS,
		RATE_LIMIT_CART_READ_POINTS: process.env.RATE_LIMIT_CART_READ_POINTS,
		RATE_LIMIT_CART_READ_WINDOW_SECONDS:
			process.env.RATE_LIMIT_CART_READ_WINDOW_SECONDS,
		RATE_LIMIT_CART_WRITE_POINTS: process.env.RATE_LIMIT_CART_WRITE_POINTS,
		RATE_LIMIT_CART_WRITE_WINDOW_SECONDS:
			process.env.RATE_LIMIT_CART_WRITE_WINDOW_SECONDS,
		RATE_LIMIT_CHECKOUT_WRITE_POINTS:
			process.env.RATE_LIMIT_CHECKOUT_WRITE_POINTS,
		RATE_LIMIT_CHECKOUT_WRITE_WINDOW_SECONDS:
			process.env.RATE_LIMIT_CHECKOUT_WRITE_WINDOW_SECONDS,
		RATE_LIMIT_CRON_POINTS: process.env.RATE_LIMIT_CRON_POINTS,
		RATE_LIMIT_CRON_WINDOW_SECONDS: process.env.RATE_LIMIT_CRON_WINDOW_SECONDS,
		RATE_LIMIT_DEFAULT_POINTS: process.env.RATE_LIMIT_DEFAULT_POINTS,
		RATE_LIMIT_DEFAULT_WINDOW_SECONDS:
			process.env.RATE_LIMIT_DEFAULT_WINDOW_SECONDS,
		RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
		RATE_LIMIT_MUTATION_POINTS: process.env.RATE_LIMIT_MUTATION_POINTS,
		RATE_LIMIT_MUTATION_WINDOW_SECONDS:
			process.env.RATE_LIMIT_MUTATION_WINDOW_SECONDS,
	};
}

export function getRateLimitConfig(
	environment: RateLimitEnvironment = readEnvironment(),
): RateLimitConfig {
	const defaultWindow = optionalInteger(
		"RATE_LIMIT_DEFAULT_WINDOW_SECONDS",
		environment.RATE_LIMIT_DEFAULT_WINDOW_SECONDS,
		1,
		86_400,
		60,
	);

	return {
		buckets: {
			auth: {
				blockDurationSeconds: 0,
				durationSeconds: optionalInteger(
					"RATE_LIMIT_AUTH_WINDOW_SECONDS",
					environment.RATE_LIMIT_AUTH_WINDOW_SECONDS,
					1,
					86_400,
					60,
				),
				points: optionalInteger(
					"RATE_LIMIT_AUTH_POINTS",
					environment.RATE_LIMIT_AUTH_POINTS,
					1,
					100_000,
					30,
				),
			},
			"cart.read": {
				blockDurationSeconds: 0,
				durationSeconds: optionalInteger(
					"RATE_LIMIT_CART_READ_WINDOW_SECONDS",
					environment.RATE_LIMIT_CART_READ_WINDOW_SECONDS,
					1,
					86_400,
					defaultWindow,
				),
				points: optionalInteger(
					"RATE_LIMIT_CART_READ_POINTS",
					environment.RATE_LIMIT_CART_READ_POINTS,
					1,
					100_000,
					300,
				),
			},
			"cart.write": {
				blockDurationSeconds: 0,
				durationSeconds: optionalInteger(
					"RATE_LIMIT_CART_WRITE_WINDOW_SECONDS",
					environment.RATE_LIMIT_CART_WRITE_WINDOW_SECONDS,
					1,
					86_400,
					defaultWindow,
				),
				points: optionalInteger(
					"RATE_LIMIT_CART_WRITE_POINTS",
					environment.RATE_LIMIT_CART_WRITE_POINTS,
					1,
					100_000,
					60,
				),
			},
			"checkout.write": {
				blockDurationSeconds: 0,
				durationSeconds: optionalInteger(
					"RATE_LIMIT_CHECKOUT_WRITE_WINDOW_SECONDS",
					environment.RATE_LIMIT_CHECKOUT_WRITE_WINDOW_SECONDS,
					1,
					86_400,
					defaultWindow,
				),
				points: optionalInteger(
					"RATE_LIMIT_CHECKOUT_WRITE_POINTS",
					environment.RATE_LIMIT_CHECKOUT_WRITE_POINTS,
					1,
					100_000,
					20,
				),
			},
			cron: {
				blockDurationSeconds: 0,
				durationSeconds: optionalInteger(
					"RATE_LIMIT_CRON_WINDOW_SECONDS",
					environment.RATE_LIMIT_CRON_WINDOW_SECONDS,
					1,
					86_400,
					60,
				),
				points: optionalInteger(
					"RATE_LIMIT_CRON_POINTS",
					environment.RATE_LIMIT_CRON_POINTS,
					1,
					100_000,
					60,
				),
			},
			default: {
				blockDurationSeconds: 0,
				durationSeconds: defaultWindow,
				points: optionalInteger(
					"RATE_LIMIT_DEFAULT_POINTS",
					environment.RATE_LIMIT_DEFAULT_POINTS,
					1,
					100_000,
					300,
				),
			},
			mutation: {
				blockDurationSeconds: 0,
				durationSeconds: optionalInteger(
					"RATE_LIMIT_MUTATION_WINDOW_SECONDS",
					environment.RATE_LIMIT_MUTATION_WINDOW_SECONDS,
					1,
					86_400,
					60,
				),
				points: optionalInteger(
					"RATE_LIMIT_MUTATION_POINTS",
					environment.RATE_LIMIT_MUTATION_POINTS,
					1,
					100_000,
					60,
				),
			},
		},
		enabled: optionalBoolean(environment.RATE_LIMIT_ENABLED) ?? true,
	};
}
