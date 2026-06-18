import { RateLimiterRes } from "rate-limiter-flexible";
import { getRateLimitConfig, type RateLimitBucket } from "./config";
import { getRateLimiter } from "./limiter";

export interface RateLimitResult {
	limit: number;
	ok: boolean;
	remaining: number;
	/** Seconds until the window resets. */
	resetSeconds: number;
	/** Seconds the caller should wait before retrying. `0` when allowed. */
	retryAfterSeconds: number;
}

export interface EnforceRateLimitOptions {
	bucket?: RateLimitBucket;
	/** Points to consume for this call. Defaults to 1. */
	cost?: number;
	/** Override the rate-limit key. Defaults to the client IP. */
	identifier?: string;
}

/**
 * Extracts the client IP from request headers.
 *
 * IMPORTANT: This function trusts x-forwarded-for and x-real-ip headers without
 * validation. It is designed for deployments behind trusted proxies (e.g.,
 * Vercel, Cloudflare) that guarantee these headers reflect the true client IP.
 * Do NOT use in environments where clients can set these headers directly.
 */
export function getClientIp(request: Request): string {
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded) {
		const first = forwarded.split(",")[0]?.trim();
		if (first) {
			return first;
		}
	}

	const realIp = request.headers.get("x-real-ip")?.trim();
	return realIp && realIp.length > 0 ? realIp : "unknown";
}

function toResult(
	ok: boolean,
	limit: number,
	response: RateLimiterRes,
): RateLimitResult {
	const resetSeconds = Math.max(0, Math.ceil(response.msBeforeNext / 1000));
	return {
		limit,
		ok,
		remaining: Math.max(0, response.remainingPoints),
		resetSeconds,
		retryAfterSeconds: ok ? 0 : resetSeconds,
	};
}

function allow(limit: number): RateLimitResult {
	return {
		limit,
		ok: true,
		remaining: limit,
		resetSeconds: 0,
		retryAfterSeconds: 0,
	};
}

export async function enforceRateLimit(
	request: Request,
	options: EnforceRateLimitOptions = {},
): Promise<RateLimitResult> {
	const bucket: RateLimitBucket = options.bucket ?? "default";
	const { buckets, enabled } = getRateLimitConfig();
	const limit = buckets[bucket].points;

	if (!enabled) {
		return allow(limit);
	}

	// Guard against empty string identifiers to prevent unrelated traffic from
	// being collapsed into a single bucket. Fall back to IP-based rate limiting.
	const identifier = options.identifier?.trim();
	const key =
		identifier && identifier.length > 0 ? identifier : getClientIp(request);

	try {
		const response = await getRateLimiter(bucket).consume(
			key,
			options.cost ?? 1,
		);
		return toResult(true, limit, response);
	} catch (error) {
		if (error instanceof RateLimiterRes) {
			return toResult(false, limit, error);
		}

		// The insurance limiter should absorb store failures; if we still land
		// here, fail open rather than reject legitimate traffic.
		console.error("[rate-limit] unexpected limiter error", error);
		return allow(limit);
	}
}

export function rateLimitHeaders(
	result: RateLimitResult,
): Record<string, string> {
	const headers: Record<string, string> = {
		"RateLimit-Limit": String(result.limit),
		"RateLimit-Remaining": String(result.remaining),
		"RateLimit-Reset": String(result.resetSeconds),
	};

	if (!result.ok) {
		headers["Retry-After"] = String(result.retryAfterSeconds);
	}

	return headers;
}

export function tooManyRequestsResponse(
	result: RateLimitResult,
	body: unknown = { error: "Too many requests" },
): Response {
	return Response.json(body, {
		headers: rateLimitHeaders(result),
		status: 429,
	});
}
