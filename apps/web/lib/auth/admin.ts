import type { AuthUser } from "@workspace/auth";
import { getServerUser } from "./session";

/**
 * Resolves the caller only when they hold the Better Auth admin role.
 * Operator-only endpoints (fiscal documents, future M7 dashboard actions)
 * must go through this; order-hub access tokens never grant admin.
 */
export async function getAdminUser(request: Request): Promise<AuthUser | null> {
	const user = await getServerUser(request);
	if (!user) {
		return null;
	}
	return user.role === "admin" ? user : null;
}
