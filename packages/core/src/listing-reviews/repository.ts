import {
	type Database,
	listingReview,
	listingReviewSummary,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

export type ListingReviewSource = "external" | "internal";

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
	return `${provider}:${accountId}:${source}:${externalId ?? crypto.randomUUID()}`;
}

export function summaryRowId(
	provider: string,
	accountId: string,
	listingExternalId: string,
): string {
	return `${provider}:${accountId}:${listingExternalId}`;
}
