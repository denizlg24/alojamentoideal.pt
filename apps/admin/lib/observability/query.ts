import { getDb, observabilityEvent } from "@workspace/db";
import { and, desc, gte, ilike, inArray, or, type SQL } from "drizzle-orm";

export const EVENT_SEVERITIES = [
	"debug",
	"info",
	"warning",
	"error",
	"critical",
] as const;
export type EventSeverityFilter = (typeof EVENT_SEVERITIES)[number];

export const EVENT_TYPES = [
	"request",
	"error",
	"rate_limit",
	"sync",
	"integration",
	"custom",
] as const;
export type EventTypeFilter = (typeof EVENT_TYPES)[number];

export const EVENT_WINDOWS = {
	"24h": 24,
	"7d": 24 * 7,
	"30d": 24 * 30,
} as const;
export type EventWindowFilter = keyof typeof EVENT_WINDOWS;

export function isEventSeverity(value: string): value is EventSeverityFilter {
	return (EVENT_SEVERITIES as readonly string[]).includes(value);
}

export function isEventType(value: string): value is EventTypeFilter {
	return (EVENT_TYPES as readonly string[]).includes(value);
}

export function isEventWindow(value: string): value is EventWindowFilter {
	return value in EVENT_WINDOWS;
}

export interface ObservabilityEventRow {
	durationMs: number | null;
	id: string;
	metadata: Record<string, unknown> | null;
	method: string | null;
	name: string;
	occurredAt: Date;
	provider: string | null;
	requestId: string | null;
	route: string | null;
	severity: string;
	statusCode: number | null;
	type: string;
}

export interface ObservabilityEventListResult {
	hasNext: boolean;
	rows: ObservabilityEventRow[];
}

export const EVENTS_PAGE_SIZE = 50;

/** Event stream, newest first. */
export async function listObservabilityEvents(filter: {
	page: number;
	query: string | null;
	severity: EventSeverityFilter | null;
	type: EventTypeFilter | null;
	window: EventWindowFilter | null;
}): Promise<ObservabilityEventListResult> {
	const conditions: SQL[] = [];
	if (filter.severity) {
		conditions.push(inArray(observabilityEvent.severity, [filter.severity]));
	}
	if (filter.type) {
		conditions.push(inArray(observabilityEvent.type, [filter.type]));
	}
	if (filter.window) {
		const since = new Date(
			Date.now() - EVENT_WINDOWS[filter.window] * 60 * 60 * 1000,
		);
		conditions.push(gte(observabilityEvent.occurredAt, since));
	}
	if (filter.query) {
		const pattern = `%${filter.query.trim()}%`;
		const match = or(
			ilike(observabilityEvent.name, pattern),
			ilike(observabilityEvent.route, pattern),
			ilike(observabilityEvent.provider, pattern),
		);
		if (match) {
			conditions.push(match);
		}
	}

	const rows = await getDb()
		.select({
			durationMs: observabilityEvent.durationMs,
			id: observabilityEvent.id,
			metadata: observabilityEvent.metadata,
			method: observabilityEvent.method,
			name: observabilityEvent.name,
			occurredAt: observabilityEvent.occurredAt,
			provider: observabilityEvent.provider,
			requestId: observabilityEvent.requestId,
			route: observabilityEvent.route,
			severity: observabilityEvent.severity,
			statusCode: observabilityEvent.statusCode,
			type: observabilityEvent.type,
		})
		.from(observabilityEvent)
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(desc(observabilityEvent.occurredAt))
		.limit(EVENTS_PAGE_SIZE + 1)
		.offset(filter.page * EVENTS_PAGE_SIZE);

	return {
		hasNext: rows.length > EVENTS_PAGE_SIZE,
		rows: rows.slice(0, EVENTS_PAGE_SIZE),
	};
}
