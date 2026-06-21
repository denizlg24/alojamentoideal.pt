import { getDb } from "@workspace/db";
import {
	createHostifyClientFromEnv,
	type HostifyCalendarEntry,
	type HostifyClient,
} from "../integrations/hostify/index";
import type { AccommodationsConfig } from "./config";
import { getAccommodationsConfig } from "./config";
import type {
	AccommodationPricingRepository,
	AccommodationScope,
} from "./repository";
import { AccommodationPricingRepository as DefaultAccommodationPricingRepository } from "./repository";

const HOSTIFY_PROVIDER = "hostify";
const MILLISECONDS_PER_DAY = 86_400_000;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * Hostify `/calendar` returns one entry per day and paginates. It has no total
 * or page-count metadata, so we walk pages until an empty page. We request a
 * large page size, but Hostify may cap it below the request (it served 20/day
 * by default), so termination relies on the empty page rather than a short one.
 */
const CALENDAR_PAGE_SIZE = 100;
const CALENDAR_MIN_EFFECTIVE_PAGE_SIZE = 20;

export interface NightlyPriceSyncStats {
	errors: NightlyPriceSyncError[];
	listingsFailed: number;
	listingsSeen: number;
	listingsSynced: number;
	nightsSynced: number;
	runId: string;
	status: "completed" | "completed_with_errors" | "failed";
}

export interface NightlyPriceSyncError {
	error: string;
	listingId: string;
}

interface NightlyPriceSyncOptions {
	client: Pick<HostifyClient, "calendar">;
	config: AccommodationsConfig;
	now?: () => Date;
	repository: AccommodationPricingRepository;
}

export function createNightlyPriceSyncFromEnv(): NightlyPriceSync {
	return new NightlyPriceSync({
		client: createHostifyClientFromEnv(),
		config: getAccommodationsConfig(),
		repository: new DefaultAccommodationPricingRepository(getDb()),
	});
}

/**
 * Re-syncs one listing's calendar from environment config. Entry point for an
 * event-driven reservation webhook to invalidate a single listing's cached
 * availability/prices.
 */
export function resyncAccommodationListing(
	listingId: string,
): Promise<NightlyPriceSyncStats> {
	return createNightlyPriceSyncFromEnv().syncListing(listingId);
}

export class NightlyPriceSync {
	readonly #client: Pick<HostifyClient, "calendar">;
	readonly #config: AccommodationsConfig;
	readonly #now: () => Date;
	readonly #repository: AccommodationPricingRepository;

	constructor(options: NightlyPriceSyncOptions) {
		this.#client = options.client;
		this.#config = options.config;
		this.#now = options.now ?? (() => new Date());
		this.#repository = options.repository;
	}

	async sync(trigger = "cron"): Promise<NightlyPriceSyncStats> {
		const stats = emptyStats();
		const scope = this.#scope();
		const listingIds = await this.#repository.listActiveListingIds(
			scope,
			this.#config.nightlyPriceSyncMaxListings,
		);
		const range = syncRange(this.#now(), this.#config.nightlyPriceSyncDays);
		const maxPages = this.#maxPages();

		for (const listingId of listingIds) {
			await this.#syncListingNights(listingId, scope, range, maxPages, stats);
		}

		return finalizeStats(stats, trigger);
	}

	/**
	 * Re-syncs a single listing's calendar. Intended for event-driven
	 * invalidation (e.g. a reservation webhook) so a freshly booked listing's
	 * availability and prices are corrected without waiting for the nightly run.
	 */
	async syncListing(
		listingId: string,
		trigger = "webhook",
	): Promise<NightlyPriceSyncStats> {
		const stats = emptyStats();
		const scope = this.#scope();
		const range = syncRange(this.#now(), this.#config.nightlyPriceSyncDays);

		await this.#syncListingNights(
			listingId,
			scope,
			range,
			this.#maxPages(),
			stats,
		);

		return finalizeStats(stats, trigger);
	}

	#scope(): { accountId: string; provider: string } {
		return {
			accountId: this.#config.hostifyAccountId,
			provider: HOSTIFY_PROVIDER,
		};
	}

	#maxPages(): number {
		return (
			Math.ceil(
				this.#config.nightlyPriceSyncDays / CALENDAR_MIN_EFFECTIVE_PAGE_SIZE,
			) + 2
		);
	}

	async #syncListingNights(
		listingId: string,
		scope: AccommodationScope,
		range: { endDate: string; startDate: string },
		maxPages: number,
		stats: NightlyPriceSyncStats,
	): Promise<void> {
		stats.listingsSeen += 1;
		try {
			const calendar = await this.#fetchCalendar(listingId, range, maxPages);
			const entries = calendar.map((entry) =>
				toUpsertInput(scope, listingId, entry, {
					currency: this.#config.currency,
					fetchedAt: this.#now(),
					staleAfterHours: 24,
				}),
			);

			await this.#repository.upsertNights(scope, entries);
			stats.listingsSynced += 1;
			stats.nightsSynced += entries.length;
		} catch (error) {
			stats.listingsFailed += 1;
			stats.errors.push({ error: normalizeError(error), listingId });
		}
	}

	async #fetchCalendar(
		listingId: string,
		range: { endDate: string; startDate: string },
		maxPages: number,
	): Promise<HostifyCalendarEntry[]> {
		const entries: HostifyCalendarEntry[] = [];

		for (let page = 1; page <= maxPages; page += 1) {
			const response = await this.#client.calendar.list({
				end_date: range.endDate,
				listing_id: listingId,
				page,
				per_page: CALENDAR_PAGE_SIZE,
				start_date: range.startDate,
			});

			if (response.calendar.length === 0) {
				break;
			}

			entries.push(...response.calendar);
		}

		return entries;
	}
}

function emptyStats(): NightlyPriceSyncStats {
	return {
		errors: [],
		listingsFailed: 0,
		listingsSeen: 0,
		listingsSynced: 0,
		nightsSynced: 0,
		runId: crypto.randomUUID(),
		status: "completed",
	};
}

function finalizeStats(
	stats: NightlyPriceSyncStats,
	trigger: string,
): NightlyPriceSyncStats {
	stats.status =
		stats.listingsFailed > 0 ? "completed_with_errors" : "completed";
	if (trigger === "throw_on_error" && stats.listingsFailed > 0) {
		stats.status = "failed";
	}

	return stats;
}

function syncRange(
	now: Date,
	days: number,
): { endDate: string; startDate: string } {
	const start = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	const end = new Date(start.getTime() + days * MILLISECONDS_PER_DAY);

	return {
		endDate: formatDate(end),
		startDate: formatDate(start),
	};
}

function toUpsertInput(
	_scope: AccommodationScope,
	listingId: string,
	entry: HostifyCalendarEntry,
	options: {
		currency: string;
		fetchedAt: Date;
		staleAfterHours: number;
	},
) {
	const status = entry.status ?? null;

	return {
		active: isEntryActive(entry),
		basePrice: entry.base_price ?? null,
		currency: entry.currency ?? options.currency,
		date: entry.date,
		fetchedAt: options.fetchedAt,
		listingExternalId: listingId,
		minStay: entry.min_stay ?? null,
		price: entry.price ?? null,
		raw: entry,
		reservationId:
			entry.reservation_id === null || entry.reservation_id === undefined
				? null
				: String(entry.reservation_id),
		staleAfter: new Date(
			options.fetchedAt.getTime() +
				options.staleAfterHours * MILLISECONDS_PER_HOUR,
		),
		status,
		syncRunId: null,
	};
}

function isEntryActive(entry: HostifyCalendarEntry): boolean {
	const status = entry.status?.toLowerCase();
	return (
		entry.price !== null &&
		entry.price !== undefined &&
		entry.reservation_id === null &&
		entry.is_manual_blocked !== 1 &&
		entry.is_preparation_blocked !== 1 &&
		status !== "blocked"
	);
}

function formatDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function normalizeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return "Nightly price sync failed";
}
