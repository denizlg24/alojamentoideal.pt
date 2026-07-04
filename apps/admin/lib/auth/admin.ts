import type { AuthUser } from "@workspace/auth";
import { redirect } from "next/navigation";
import { getCurrentUser, getServerUser } from "./session";

/**
 * Resolves the caller only when they hold the Better Auth admin role. Every
 * route handler in this app must gate on this; a signed-in guest account is
 * treated the same as an anonymous caller.
 */
export async function getAdminUser(request: Request): Promise<AuthUser | null> {
	const user = await getServerUser(request);
	if (!user) {
		return null;
	}
	return user.role === "admin" ? user : null;
}

/**
 * Page/layout guard: redirects anonymous callers to the login page and
 * signed-in non-admins to the login page with a forbidden notice.
 */
export async function requireAdminUser(): Promise<AuthUser> {
	const user = await getCurrentUser();
	if (!user) {
		redirect("/login");
	}
	if (user.role !== "admin") {
		redirect("/login?error=forbidden");
	}
	return user;
}
