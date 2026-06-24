import { AccountProfileRepository } from "@workspace/core/account";
import { getDb } from "@workspace/db";

/**
 * Builds a request-scoped AccountProfileRepository. Mirrors `commerceService`:
 * fresh per call, cheap because the underlying Postgres pool is a singleton.
 */
export function accountProfileRepository(): AccountProfileRepository {
	return new AccountProfileRepository(getDb());
}
