import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		await import("./sentry.server.config");
	}

	if (process.env.NEXT_RUNTIME === "edge") {
		await import("./sentry.edge.config");
	}
}

/**
 * Forwards server errors to Sentry (technical telemetry) and mirrors a coarse
 * record into the Postgres observability log (product analytics). The Postgres
 * write only runs on the Node.js runtime, where `@workspace/db`'s `pg` driver
 * is available.
 */
export const onRequestError: Instrumentation.onRequestError = async (
	error,
	request,
	context,
) => {
	Sentry.captureRequestError(error, request, context);

	if (process.env.NEXT_RUNTIME !== "nodejs") {
		return;
	}

	try {
		// `onRequestError` is awaited by Next.js, so awaiting the insert here is
		// safe and guarantees completion before the function is torn down.
		const { recordEvent } = await import("@workspace/core/observability");
		const digest =
			typeof error === "object" && error !== null && "digest" in error
				? String((error as { digest?: unknown }).digest)
				: undefined;

		await recordEvent({
			metadata: {
				digest,
				path: request.path,
				renderSource: context.renderSource,
				routeType: context.routeType,
			},
			method: request.method,
			name: "request_error",
			route: context.routePath,
			severity: "error",
			source: "next",
			type: "error",
		});
	} catch {
		// Never let observability bookkeeping mask the original error.
	}
};
