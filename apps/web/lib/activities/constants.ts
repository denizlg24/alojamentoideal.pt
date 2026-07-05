/**
 * Activities are sold through Bokun and rendered from a synced Postgres
 * projection. Availability remains live because prices and seats are volatile.
 * See `./source`.
 */

/** Base currency for advisory "from" prices and the booking widget. */
export const ACTIVITY_CURRENCY = "EUR";

/** The `apps/web` rewrite is English-only for now (see AGENTS.md). */
export const ACTIVITY_LANG = "en";

/** Cache tags so a future Bokun webhook/cron can revalidate precisely. */
export const ACTIVITIES_LIST_TAG = "activities:list";
export function activityDetailTag(id: string): string {
	return `activities:detail:${id}`;
}
