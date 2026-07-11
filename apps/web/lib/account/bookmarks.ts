import "server-only";

import {
	AccountBookmarkRepository,
	type BookmarkScope,
} from "@workspace/core/account";
import { getDb } from "@workspace/db";
import { defaultCatalogScope } from "@/lib/catalog/scope";

/** Catalog scope bookmarks are stored under (the site's single Hostify account). */
export function bookmarkScope(): BookmarkScope {
	return defaultCatalogScope();
}

/**
 * Builds a request-scoped AccountBookmarkRepository. Mirrors
 * `accountProfileRepository`: fresh per call, cheap because the underlying
 * Postgres pool is a singleton.
 */
export function accountBookmarkRepository(): AccountBookmarkRepository {
	return new AccountBookmarkRepository(getDb());
}
