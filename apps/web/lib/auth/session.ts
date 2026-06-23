import { type AuthUser, getAuth } from "@workspace/auth";
import { headers } from "next/headers";

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

/**
 * Server Component variant of {@link getServerUser}: reads the incoming request
 * headers via `next/headers` so pages and layouts can resolve the current user
 * without a `Request` object. Marks the caller as dynamically rendered.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
	const session = await getAuth().api.getSession({ headers: await headers() });
	return session?.user ?? null;
}
