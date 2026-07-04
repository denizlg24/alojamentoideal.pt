import {
	logger,
	type ObservabilityEventInput,
	recordEvent,
} from "@workspace/core/observability";
import { after } from "next/server";

/** Flattens an error (including a drizzle/pg `cause`) into loggable fields. */
export function describeError(error: unknown): Record<string, unknown> {
	if (!(error instanceof Error)) {
		return { error: String(error) };
	}

	const cause = (error as { cause?: unknown }).cause;
	return {
		cause:
			cause instanceof Error
				? cause.message
				: cause !== undefined
					? String(cause)
					: undefined,
		error: error.message,
	};
}

/**
 * Schedules an observability write to run *after* the response is sent, via
 * Next's `after()`. On serverless platforms this is backed by `waitUntil`,
 * which keeps the invocation alive until the insert settles; a bare
 * fire-and-forget promise gets killed at function teardown.
 */
export function scheduleEvent(event: ObservabilityEventInput): void {
	after(async () => {
		try {
			await recordEvent(event);
		} catch (error) {
			logger.error("failed to record observability event", {
				name: event.name,
				type: event.type,
				...describeError(error),
			});
		}
	});
}
