import {
	type RateLimiterAbstract,
	RateLimiterMemory,
	RateLimiterRedis,
} from "rate-limiter-flexible";
import { getRedis } from "../redis/client";
import { getRateLimitConfig, type RateLimitBucket } from "./config";

const limiters = new Map<RateLimitBucket, RateLimiterAbstract>();

function createLimiter(bucket: RateLimitBucket): RateLimiterAbstract {
	const { buckets } = getRateLimitConfig();
	const settings = buckets[bucket];

	const insuranceLimiter = new RateLimiterMemory({
		duration: settings.durationSeconds,
		points: settings.points,
	});

	return new RateLimiterRedis({
		blockDuration: settings.blockDurationSeconds,
		duration: settings.durationSeconds,
		// Falls back to the in-memory limiter when Redis is unavailable, so a
		// Redis outage never turns into an application error.
		insuranceLimiter,
		keyPrefix: `rl:${bucket}`,
		points: settings.points,
		storeClient: getRedis(),
	});
}

export function getRateLimiter(bucket: RateLimitBucket): RateLimiterAbstract {
	let limiter = limiters.get(bucket);
	if (!limiter) {
		limiter = createLimiter(bucket);
		limiters.set(bucket, limiter);
	}

	return limiter;
}
