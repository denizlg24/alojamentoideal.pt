import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import {
	hashIdentifier,
	logger,
	trackEvent,
} from "@workspace/core/observability";
import {
	enforceRateLimit,
	getClientIp,
	type RateLimitBucket,
	rateLimitHeaders,
	tooManyRequestsResponse,
} from "@workspace/core/rate-limit";

interface RateLimitRouteOptions {
	bucket?: RateLimitBucket;
	/** Override the rate-limit key (defaults to client IP). */
	identifier?: (request: Request) => string | undefined;
}

export interface ApiRouteOptions {
	/**
	 * Emit per-request analytics events. Defaults to `true`. Set `false` for
	 * high-frequency, low-signal routes (e.g. health checks) to avoid flooding
	 * the observability log. Errors are always captured regardless.
	 */
	analytics?: boolean;
	/** Logical route name used for analytics and logs. */
	name: string;
	/** Rate-limit settings, or `false` to skip rate limiting for this route. */
	rateLimit?: RateLimitRouteOptions | false;
}

type RouteHandler<Ctx> = (
	request: Request,
	context: Ctx,
) => Promise<Response> | Response;

/**
 * Wraps a route handler with rate limiting, structured logging, error capture
 * (Sentry + Postgres) and per-request analytics. Every request emits one
 * `request` event; failures additionally emit an `error` event.
 */
export function withApiRoute<Ctx = unknown>(
	options: ApiRouteOptions,
	handler: RouteHandler<Ctx>,
): (request: Request, context: Ctx) => Promise<Response> {
	return async (request, context) => {
		const requestId = request.headers.get("x-request-id") ?? randomUUID();
		const ipHash = hashIdentifier(getClientIp(request));
		const route = new URL(request.url).pathname;
		const method = request.method;
		const startedAt = performance.now();
		const elapsed = () => Math.round(performance.now() - startedAt);

		const analyticsEnabled = options.analytics !== false;
		const rateLimitEnabled = options.rateLimit !== false;
		const rateLimitConfig: RateLimitRouteOptions = options.rateLimit || {};

		const rateLimitResult = rateLimitEnabled
			? await enforceRateLimit(request, {
					bucket: rateLimitConfig.bucket,
					identifier: rateLimitConfig.identifier?.(request),
				})
			: undefined;

		if (rateLimitResult && !rateLimitResult.ok) {
			if (analyticsEnabled) {
				trackEvent({
					durationMs: elapsed(),
					ipHash,
					method,
					name: options.name,
					requestId,
					route,
					severity: "warning",
					statusCode: 429,
					type: "rate_limit",
				});
			}
			return tooManyRequestsResponse(rateLimitResult);
		}

		let response: Response;
		try {
			response = await handler(request, context);
		} catch (error) {
			Sentry.captureException(error);
			logger.error("api route failed", {
				error: error instanceof Error ? error.message : String(error),
				method,
				name: options.name,
				requestId,
				route,
			});
			trackEvent({
				durationMs: elapsed(),
				ipHash,
				method,
				name: options.name,
				requestId,
				route,
				severity: "error",
				statusCode: 500,
				type: "error",
			});
			response = Response.json(
				{ error: "Internal server error" },
				{ status: 500 },
			);
		}

		if (rateLimitResult) {
			for (const [key, value] of Object.entries(
				rateLimitHeaders(rateLimitResult),
			)) {
				response.headers.set(key, value);
			}
		}
		response.headers.set("x-request-id", requestId);

		if (analyticsEnabled) {
			trackEvent({
				durationMs: elapsed(),
				ipHash,
				method,
				name: options.name,
				requestId,
				route,
				severity: response.status >= 500 ? "error" : "info",
				statusCode: response.status,
				type: "request",
			});
		}

		return response;
	};
}
