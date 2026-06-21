import {
	accommodationListing,
	accommodationListingNight,
	type Database,
} from "@workspace/db";
import { and, asc, eq, gte, inArray, lt, min, sql } from "drizzle-orm";

export interface AccommodationScope {
	accountId: string;
	provider: string;
}

export interface UpsertNightInput {
	active: boolean;
	basePrice: number | null;
	currency: string | null;
	date: string;
	fetchedAt: Date;
	listingExternalId: string;
	minStay: number | null;
	price: number | null;
	raw: Record<string, unknown>;
	reservationId: string | null;
	staleAfter: Date;
	status: string | null;
	syncRunId: string | null;
}

export interface NightlyPriceSummary {
	currency: string;
	fromPrice: number | null;
	listingId: string;
}

export interface ListingNight {
	active: boolean;
	date: string;
	minStay: number | null;
	price: number | null;
}

export interface StayAvailability {
	available: boolean;
	currency: string;
	listingId: string;
	nightlyFrom: number | null;
	nights: number;
	total: number | null;
}

export class AccommodationPricingRepository {
	readonly #db: Database;

	constructor(db: Database) {
		this.#db = db;
	}

	async listActiveListingIds(
		scope: AccommodationScope,
		input: { limit: number; offset?: number },
	): Promise<string[]> {
		const rows = await this.#db
			.select({ externalId: accommodationListing.externalId })
			.from(accommodationListing)
			.where(
				and(
					eq(accommodationListing.provider, scope.provider),
					eq(accommodationListing.externalAccountId, scope.accountId),
					eq(accommodationListing.active, true),
				),
			)
			.orderBy(asc(accommodationListing.externalId))
			.limit(input.limit)
			.offset(input.offset ?? 0);

		return rows.map((row) => row.externalId);
	}

	async upsertNights(
		scope: AccommodationScope,
		inputs: UpsertNightInput[],
	): Promise<void> {
		if (inputs.length === 0) {
			return;
		}

		const now = new Date();
		await this.#db
			.insert(accommodationListingNight)
			.values(
				inputs.map((input) => ({
					active: input.active,
					basePrice: input.basePrice,
					currency: input.currency,
					date: input.date,
					externalAccountId: scope.accountId,
					fetchedAt: input.fetchedAt,
					id: nightlyPriceId(scope, input.listingExternalId, input.date),
					listingExternalId: input.listingExternalId,
					minStay: input.minStay,
					price: input.price,
					provider: scope.provider,
					raw: { calendar: input.raw },
					reservationId: input.reservationId,
					staleAfter: input.staleAfter,
					status: input.status,
					syncRunId: input.syncRunId,
					updatedAt: now,
				})),
			)
			.onConflictDoUpdate({
				set: {
					active: sql`excluded.active`,
					basePrice: sql`excluded.base_price`,
					currency: sql`excluded.currency`,
					fetchedAt: sql`excluded.fetched_at`,
					minStay: sql`excluded.min_stay`,
					price: sql`excluded.price`,
					raw: sql`excluded.raw`,
					reservationId: sql`excluded.reservation_id`,
					staleAfter: sql`excluded.stale_after`,
					status: sql`excluded.status`,
					syncRunId: sql`excluded.sync_run_id`,
					updatedAt: sql`excluded.updated_at`,
				},
				target: [
					accommodationListingNight.provider,
					accommodationListingNight.externalAccountId,
					accommodationListingNight.listingExternalId,
					accommodationListingNight.date,
				],
			});
	}

	/**
	 * Reads the synced nightly calendar for a single listing across a date window,
	 * powering the listing page's availability-aware date picker: inactive or
	 * missing dates are unbookable, and `minStay` on a candidate arrival night
	 * gates the shortest valid stay. Returned ordered by date for cheap windowing
	 * on the client.
	 */
	async listNightsForListing(
		scope: AccommodationScope,
		listingExternalId: string,
		input: { from: string; to: string },
	): Promise<ListingNight[]> {
		const rows = await this.#db
			.select({
				active: accommodationListingNight.active,
				date: accommodationListingNight.date,
				minStay: accommodationListingNight.minStay,
				price: accommodationListingNight.price,
			})
			.from(accommodationListingNight)
			.where(
				and(
					eq(accommodationListingNight.provider, scope.provider),
					eq(accommodationListingNight.externalAccountId, scope.accountId),
					eq(accommodationListingNight.listingExternalId, listingExternalId),
					gte(accommodationListingNight.date, input.from),
					lt(accommodationListingNight.date, input.to),
				),
			)
			.orderBy(asc(accommodationListingNight.date));

		return rows.map((row) => ({
			active: row.active,
			date: row.date,
			minStay: row.minStay,
			price: row.price === null ? null : Number(row.price),
		}));
	}

	async fromPricesForListings(
		scope: AccommodationScope,
		input: {
			checkIn?: string;
			checkOut?: string;
			currency: string;
			listingIds: string[];
		},
	): Promise<Map<string, NightlyPriceSummary>> {
		if (input.listingIds.length === 0) {
			return new Map();
		}

		const conditions = [
			eq(accommodationListingNight.provider, scope.provider),
			eq(accommodationListingNight.externalAccountId, scope.accountId),
			inArray(accommodationListingNight.listingExternalId, input.listingIds),
			eq(accommodationListingNight.active, true),
		];

		if (input.checkIn && input.checkOut) {
			conditions.push(gte(accommodationListingNight.date, input.checkIn));
			conditions.push(lt(accommodationListingNight.date, input.checkOut));
		}

		const rows = await this.#db
			.select({
				currency: sql<string>`coalesce(${accommodationListingNight.currency}, ${input.currency})`,
				fromPrice: min(accommodationListingNight.price),
				listingId: accommodationListingNight.listingExternalId,
			})
			.from(accommodationListingNight)
			.where(and(...conditions))
			.groupBy(
				accommodationListingNight.listingExternalId,
				accommodationListingNight.currency,
			);

		return new Map(
			rows.map((row) => [
				`${row.listingId}:${row.currency}`,
				{
					currency: row.currency,
					fromPrice: row.fromPrice === null ? null : Number(row.fromPrice),
					listingId: row.listingId,
				},
			]),
		);
	}

	/**
	 * Derives stay availability and a base-price estimate per listing straight
	 * from the synced nightly calendar, replacing the live Hostify availability
	 * call on the homes grid. A listing is available when every night in
	 * `[checkIn, checkOut)` is active and the arrival-night min-stay is satisfied.
	 * `total` is the summed nightly base price, left null when any night lacks a
	 * price so the card can fall back to the `nightlyFrom` rate.
	 */
	async availabilityForStay(
		scope: AccommodationScope,
		input: {
			checkIn: string;
			checkOut: string;
			currency: string;
			listingIds: string[];
			nights: number;
		},
	): Promise<Map<string, StayAvailability>> {
		if (input.listingIds.length === 0) {
			return new Map();
		}

		const rows = await this.#db
			.select({
				activeNights: sql<string>`count(*) filter (where ${accommodationListingNight.active})`,
				arrivalMinStay: sql<
					number | null
				>`max(case when ${accommodationListingNight.date} = ${input.checkIn} then ${accommodationListingNight.minStay} end)`,
				currency: sql<string>`coalesce(min(${accommodationListingNight.currency}), ${input.currency})`,
				listingId: accommodationListingNight.listingExternalId,
				nightlyFrom: sql<
					number | null
				>`min(${accommodationListingNight.price}) filter (where ${accommodationListingNight.active})`,
				pricedNights: sql<string>`count(${accommodationListingNight.price}) filter (where ${accommodationListingNight.active})`,
				total: sql<
					number | null
				>`sum(${accommodationListingNight.price}) filter (where ${accommodationListingNight.active})`,
			})
			.from(accommodationListingNight)
			.where(
				and(
					eq(accommodationListingNight.provider, scope.provider),
					eq(accommodationListingNight.externalAccountId, scope.accountId),
					inArray(
						accommodationListingNight.listingExternalId,
						input.listingIds,
					),
					gte(accommodationListingNight.date, input.checkIn),
					lt(accommodationListingNight.date, input.checkOut),
				),
			)
			.groupBy(accommodationListingNight.listingExternalId);

		const result = new Map<string, StayAvailability>();
		for (const row of rows) {
			const activeNights = Number(row.activeNights);
			const pricedNights = Number(row.pricedNights);
			const arrivalMinStay =
				row.arrivalMinStay === null ? null : Number(row.arrivalMinStay);
			const allNightsActive = activeNights === input.nights;
			const minStaySatisfied =
				arrivalMinStay === null || arrivalMinStay <= input.nights;

			result.set(row.listingId, {
				available: allNightsActive && minStaySatisfied,
				currency: row.currency,
				listingId: row.listingId,
				nightlyFrom: row.nightlyFrom === null ? null : Number(row.nightlyFrom),
				nights: input.nights,
				total:
					pricedNights === input.nights && row.total !== null
						? Number(row.total)
						: null,
			});
		}

		return result;
	}
}

export function nightlyPriceId(
	scope: AccommodationScope,
	listingExternalId: string,
	date: string,
): string {
	return `${scope.provider}:${scope.accountId}:${listingExternalId}:${date}`;
}
