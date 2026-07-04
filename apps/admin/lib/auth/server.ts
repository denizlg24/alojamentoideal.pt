import { type Auth, createAuth } from "@workspace/auth";

let instance: Auth | undefined;

/**
 * Admin-origin Better Auth instance. Shares the user/session tables with the
 * guest-facing web app but advertises this app's own origin so cookies and
 * origin checks work on the admin domain. Lazy for the same reason as the
 * web app's `getAuth()`: nothing may run at module load during build trace.
 */
export function getAdminAuth(): Auth {
	instance ??= createAuth({
		baseURL: process.env.ADMIN_AUTH_URL ?? "http://localhost:3001",
	});

	return instance;
}
