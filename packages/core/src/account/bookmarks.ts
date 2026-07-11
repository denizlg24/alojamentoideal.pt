import { type Database, listingBookmark } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

/** Catalog scope a bookmark belongs to, mirroring `CatalogScope`. */
export interface BookmarkScope {
	accountId: string;
	provider: string;
}

function bookmarkRowId(
	userId: string,
	scope: BookmarkScope,
	listingExternalId: string,
): string {
	return `${userId}:${scope.provider}:${scope.accountId}:${listingExternalId}`;
}

/**
 * Saved-listing bookmarks for signed-in guests. Rows are keyed by
 * (user, catalog scope, listing external id) so saving is idempotent and a
 * listing resync never orphans the bookmark.
 */
export class AccountBookmarkRepository {
	constructor(private readonly db: Database) {}

	/** Bookmarked listing external ids for a user, newest first. */
	async listListingExternalIds(
		userId: string,
		scope: BookmarkScope,
	): Promise<string[]> {
		const rows = await this.db
			.select({ listingExternalId: listingBookmark.listingExternalId })
			.from(listingBookmark)
			.where(
				and(
					eq(listingBookmark.userId, userId),
					eq(listingBookmark.provider, scope.provider),
					eq(listingBookmark.externalAccountId, scope.accountId),
				),
			)
			.orderBy(desc(listingBookmark.createdAt));
		return rows.map((row) => row.listingExternalId);
	}

	async add(
		userId: string,
		scope: BookmarkScope,
		listingExternalId: string,
	): Promise<void> {
		await this.db
			.insert(listingBookmark)
			.values({
				createdAt: new Date(),
				externalAccountId: scope.accountId,
				id: bookmarkRowId(userId, scope, listingExternalId),
				listingExternalId,
				provider: scope.provider,
				userId,
			})
			.onConflictDoNothing();
	}

	async remove(
		userId: string,
		scope: BookmarkScope,
		listingExternalId: string,
	): Promise<void> {
		await this.db
			.delete(listingBookmark)
			.where(
				and(
					eq(listingBookmark.userId, userId),
					eq(listingBookmark.provider, scope.provider),
					eq(listingBookmark.externalAccountId, scope.accountId),
					eq(listingBookmark.listingExternalId, listingExternalId),
				),
			);
	}
}
