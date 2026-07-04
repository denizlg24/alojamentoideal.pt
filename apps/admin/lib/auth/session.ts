import type { AuthUser } from "@workspace/auth";
import { headers } from "next/headers";
import { getAdminAuth } from "./server";

/**
 * Resolves the authenticated user for a route-handler request, or `null` for
 * anonymous callers.
 */
export async function getServerUser(
	request: Request,
): Promise<AuthUser | null> {
	const session = await getAdminAuth().api.getSession({
		headers: request.headers,
	});
	return session?.user ?? null;
}

/**
 * Server Component variant of {@link getServerUser}: reads the incoming
 * request headers via `next/headers`. Marks the caller as dynamically
 * rendered.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
	const session = await getAdminAuth().api.getSession({
		headers: await headers(),
	});
	return session?.user ?? null;
}
