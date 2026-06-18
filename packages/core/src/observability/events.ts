import { createHash, randomUUID } from "node:crypto";
import { getDb, observabilityEvent } from "@workspace/db";
import { optionalBoolean, optionalString } from "../internal/env";
import { logger } from "./logger";

export type ObservabilityEventType =
	| "request"
	| "error"
	| "rate_limit"
	| "sync"
	| "integration"
	| "custom";

export type ObservabilitySeverity =
	| "debug"
	| "info"
	| "warning"
	| "error"
	| "critical";

export interface ObservabilityEventInput {
	durationMs?: number;
	ipHash?: string;
	metadata?: Record<string, unknown>;
	method?: string;
	name: string;
	occurredAt?: Date;
	provider?: string;
	requestId?: string;
	route?: string;
	severity?: ObservabilitySeverity;
	source?: string;
	statusCode?: number;
	type: ObservabilityEventType;
	userId?: string;
}

function isEnabled(): boolean {
	return optionalBoolean(process.env.OBSERVABILITY_ENABLED) ?? true;
}

/**
 * Hashes a client identifier (typically an IP) so analytics can count distinct
 * actors without persisting personal data. An optional salt rotates the hash.
 */
export function hashIdentifier(value: string): string {
	const salt = optionalString(process.env.OBSERVABILITY_IP_SALT) ?? "";
	return createHash("sha256")
		.update(`${salt}${value}`)
		.digest("hex")
		.slice(0, 32);
}

/** Inserts a single event. Awaitable; throws on failure. Prefer {@link trackEvent}. */
export async function recordEvent(
	event: ObservabilityEventInput,
): Promise<void> {
	if (!isEnabled()) {
		return;
	}

	await getDb()
		.insert(observabilityEvent)
		.values({
			durationMs: event.durationMs,
			id: randomUUID(),
			ipHash: event.ipHash,
			metadata: event.metadata,
			method: event.method,
			name: event.name,
			occurredAt: event.occurredAt ?? new Date(),
			provider: event.provider,
			requestId: event.requestId,
			route: event.route,
			severity: event.severity ?? "info",
			source: event.source,
			statusCode: event.statusCode,
			type: event.type,
			userId: event.userId,
		});
}

/**
 * Fire-and-forget event recording. Never rejects into the caller, so it is safe
 * to call from request handlers without awaiting.
 */
export function trackEvent(event: ObservabilityEventInput): void {
	void recordEvent(event).catch((error) => {
		const cause =
			error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
		logger.error("failed to record observability event", {
			cause: cause instanceof Error ? cause.message : cause,
			error: error instanceof Error ? error.message : String(error),
			name: event.name,
			type: event.type,
		});
	});
}
