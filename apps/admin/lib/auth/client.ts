import type { Auth } from "@workspace/auth";
import { adminClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Same-origin auth client: no baseURL so requests target this app's own
 * /api/auth mount rather than the web app's.
 */
export const authClient = createAuthClient({
	plugins: [adminClient(), inferAdditionalFields<Auth>()],
});

export const { signIn, signOut, useSession, admin } = authClient;
