import {
	type Database,
	listingReview,
	listingReviewSummary,
} from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

export type ListingReviewSource = "external" | "internal";

export interface ListingReviewDto {
	accuracyRating: number | null;
	channel: string | null;
	checkinRating: number | null;
	cleanRating: number | null;
	comments: string;
	communicationRating: number | null;
	guestName: string | null;
	id: string;
	locationRating: number | null;
	rating: number | null;
	reviewedAt: string | null;
	source: ListingReviewSource;
	valueRating: number | null;
}

export interface ListingReviewCategoryAverages {
	accuracy: number | null;
	checkin: number | null;
	cleanliness: number | null;
	communication: number | null;
	location: number | null;
	value: number | null;
}

export interface UpsertReviewInput {
	accountId: string;
	accuracyRating: number | null;
	channel: string | null;
	channelListingExternalId: string | null;
	channelReviewId: string | null;
	checkinRating: number | null;
	cleanRating: number | null;
	comments: string | null;
	communicationRating: number | null;
	externalId: string | null;
	guestId: string | null;
	guestName: string | null;
	language: string | null;
	listingExternalId: string;
	locationRating: number | null;
	provider: string;
	rating: number | null;
	raw: Record<string, unknown> | null;
	reservationId: string | null;
	reviewedAt: Date | null;
	source: ListingReviewSource;
	status: string;
	syncRunId: string | null;
	valueRating: number | null;
}

export class ListingReviewRepository {
	readonly #db: Database;

	constructor(db: Database) {
		this.#db = db;
	}

	async upsertReview(input: UpsertReviewInput): Promise<void> {
		const now = new Date();
		const values: typeof listingReview.$inferInsert = {
			accuracyRating: input.accuracyRating,
			channel: input.channel,
			channelListingExternalId: input.channelListingExternalId,
			channelReviewId: input.channelReviewId,
			checkinRating: input.checkinRating,
			cleanRating: input.cleanRating,
			comments: input.comments,
			communicationRating: input.communicationRating,
			externalAccountId: input.accountId,
			externalId: input.externalId,
			guestId: input.guestId,
			guestName: input.guestName,
			id: reviewRowId(
				input.provider,
				input.accountId,
				input.source,
				input.externalId,
			),
			language: input.language,
			listingExternalId: input.listingExternalId,
			locationRating: input.locationRating,
			provider: input.provider,
			rating: input.rating,
			raw: input.raw,
			reservationId: input.reservationId,
			reviewedAt: input.reviewedAt,
			source: input.source,
			status: input.status,
			syncRunId: input.syncRunId,
			updatedAt: now,
			valueRating: input.valueRating,
		};

		await this.#db
			.insert(listingReview)
			.values(values)
			.onConflictDoUpdate({
				set: {
					accuracyRating: values.accuracyRating,
					channel: values.channel,
					channelListingExternalId: values.channelListingExternalId,
					channelReviewId: values.channelReviewId,
					checkinRating: values.checkinRating,
					cleanRating: values.cleanRating,
					comments: values.comments,
					communicationRating: values.communicationRating,
					guestId: values.guestId,
					guestName: values.guestName,
					language: values.language,
					listingExternalId: values.listingExternalId,
					locationRating: values.locationRating,
					rating: values.rating,
					raw: values.raw,
					reservationId: values.reservationId,
					reviewedAt: values.reviewedAt,
					status: values.status,
					syncRunId: values.syncRunId,
					updatedAt: values.updatedAt,
					valueRating: values.valueRating,
				},
				target: [
					listingReview.provider,
					listingReview.externalAccountId,
					listingReview.source,
					listingReview.externalId,
				],
			});
	}

	/**
	 * Reads the published, commented reviews for a listing's public detail page,
	 * newest first. Empty-comment reviews still feed the rating badge but have no
	 * card to render, so they are filtered out here. `source` lets the UI tag each
	 * card with its origin (external channel vs internal/direct guest).
	 */
	async listForListing(
		provider: string,
		accountId: string,
		listingExternalId: string,
		options: { limit: number },
	): Promise<ListingReviewDto[]> {
		const rows = await this.#db
			.select({
				accuracyRating: listingReview.accuracyRating,
				channel: listingReview.channel,
				checkinRating: listingReview.checkinRating,
				cleanRating: listingReview.cleanRating,
				comments: listingReview.comments,
				communicationRating: listingReview.communicationRating,
				guestName: listingReview.guestName,
				id: listingReview.id,
				locationRating: listingReview.locationRating,
				rating: listingReview.rating,
				reviewedAt: listingReview.reviewedAt,
				source: listingReview.source,
				valueRating: listingReview.valueRating,
			})
			.from(listingReview)
			.where(
				and(
					eq(listingReview.provider, provider),
					eq(listingReview.externalAccountId, accountId),
					eq(listingReview.listingExternalId, listingExternalId),
					eq(listingReview.status, "published"),
					isNotNull(listingReview.comments),
				),
			)
			.orderBy(desc(listingReview.reviewedAt))
			.limit(options.limit);

		return rows
			.filter((row): row is typeof row & { comments: string } =>
				Boolean(row.comments && row.comments.trim().length > 0),
			)
			.map((row) => ({
				accuracyRating: row.accuracyRating,
				channel: row.channel,
				checkinRating: row.checkinRating,
				cleanRating: row.cleanRating,
				comments: row.comments,
				communicationRating: row.communicationRating,
				guestName: row.guestName,
				id: row.id,
				locationRating: row.locationRating,
				rating: row.rating,
				reviewedAt: row.reviewedAt?.toISOString() ?? null,
				source: row.source === "internal" ? "internal" : "external",
				valueRating: row.valueRating,
			}));
	}

	/**
	 * Averages each rating category across a listing's published reviews for the
	 * reviews summary breakdown (Cleanliness, Accuracy, ...). Returns `null` per
	 * category when no review carries that sub-rating.
	 */
	async categoryAveragesForListing(
		provider: string,
		accountId: string,
		listingExternalId: string,
	): Promise<ListingReviewCategoryAverages> {
		const [row] = await this.#db
			.select({
				accuracy: sql<
					number | null
				>`avg(${listingReview.accuracyRating})::double precision`,
				checkin: sql<
					number | null
				>`avg(${listingReview.checkinRating})::double precision`,
				cleanliness: sql<
					number | null
				>`avg(${listingReview.cleanRating})::double precision`,
				communication: sql<
					number | null
				>`avg(${listingReview.communicationRating})::double precision`,
				location: sql<
					number | null
				>`avg(${listingReview.locationRating})::double precision`,
				value: sql<
					number | null
				>`avg(${listingReview.valueRating})::double precision`,
			})
			.from(listingReview)
			.where(
				and(
					eq(listingReview.provider, provider),
					eq(listingReview.externalAccountId, accountId),
					eq(listingReview.listingExternalId, listingExternalId),
					eq(listingReview.status, "published"),
				),
			);

		return {
			accuracy: row?.accuracy ?? null,
			checkin: row?.checkin ?? null,
			cleanliness: row?.cleanliness ?? null,
			communication: row?.communication ?? null,
			location: row?.location ?? null,
			value: row?.value ?? null,
		};
	}

	/**
	 * Recomputes the combined per-listing aggregate from `listingReview` rows for
	 * the given listings. Only published reviews with an overall rating count
	 * toward the badge; the per-source counts let us split external/internal
	 * later.
	 */
	async recomputeSummaries(
		provider: string,
		accountId: string,
		listingExternalIds: string[],
	): Promise<void> {
		if (listingExternalIds.length === 0) {
			return;
		}

		const rows = await this.#db
			.select({
				externalCount: sql<number>`(count(${listingReview.rating}) filter (where ${listingReview.source} = 'external'))::int`,
				internalCount: sql<number>`(count(${listingReview.rating}) filter (where ${listingReview.source} = 'internal'))::int`,
				listingExternalId: listingReview.listingExternalId,
				ratingAverage: sql<
					number | null
				>`avg(${listingReview.rating})::double precision`,
				reviewCount: sql<number>`count(${listingReview.rating})::int`,
			})
			.from(listingReview)
			.where(
				and(
					eq(listingReview.provider, provider),
					eq(listingReview.externalAccountId, accountId),
					eq(listingReview.status, "published"),
					inArray(listingReview.listingExternalId, listingExternalIds),
				),
			)
			.groupBy(listingReview.listingExternalId);

		if (rows.length === 0) {
			return;
		}

		const now = new Date();
		const values: (typeof listingReviewSummary.$inferInsert)[] = rows.map(
			(row) => ({
				externalAccountId: accountId,
				externalCount: row.externalCount,
				id: summaryRowId(provider, accountId, row.listingExternalId),
				internalCount: row.internalCount,
				listingExternalId: row.listingExternalId,
				provider,
				ratingAverage: row.ratingAverage,
				reviewCount: row.reviewCount,
				updatedAt: now,
			}),
		);

		await this.#db
			.insert(listingReviewSummary)
			.values(values)
			.onConflictDoUpdate({
				set: {
					externalCount: sql`excluded.external_count`,
					internalCount: sql`excluded.internal_count`,
					ratingAverage: sql`excluded.rating_average`,
					reviewCount: sql`excluded.review_count`,
					updatedAt: sql`excluded.updated_at`,
				},
				target: [
					listingReviewSummary.provider,
					listingReviewSummary.externalAccountId,
					listingReviewSummary.listingExternalId,
				],
			});
	}
}

export function reviewRowId(
	provider: string,
	accountId: string,
	source: ListingReviewSource,
	externalId: string | null,
): string {
	if (source === "external" && externalId === null) {
		throw new Error(
			"externalId is required for external reviews to ensure deduplication",
		);
	}
	if (source === "internal" && externalId !== null) {
		throw new Error(
			"externalId must be null for internal reviews; each internal review gets a unique id",
		);
	}
	return `${provider}:${accountId}:${source}:${externalId ?? crypto.randomUUID()}`;
}

export function summaryRowId(
	provider: string,
	accountId: string,
	listingExternalId: string,
): string {
	return `${provider}:${accountId}:${listingExternalId}`;
}
