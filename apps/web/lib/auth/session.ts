import { type AuthUser, getAuth } from "@workspace/auth";

/**
 * Resolves the authenticated user for a route-handler request, or `null` for
 * anonymous callers. Wraps the Better Auth session lookup so routes do not
 * repeat the `getSession({ headers })` boilerplate.
 */
export async function getServerUser(
	request: Request,
): Promise<AuthUser | null> {
	const session = await getAuth().api.getSession({ headers: request.headers });
	return session?.user ?? null;
}
