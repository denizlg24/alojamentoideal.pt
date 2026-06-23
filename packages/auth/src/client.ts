import { adminClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { Auth } from "./auth";

function resolveBaseURL(): string | undefined {
	if (typeof process !== "undefined") {
		return process.env.NEXT_PUBLIC_AUTH_URL ?? undefined;
	}

	return undefined;
}

export const authClient = createAuthClient({
	baseURL: resolveBaseURL(),
	// inferAdditionalFields surfaces server-defined user fields (e.g. dateOfBirth)
	// on typed client calls like signUp.email. Type-only import, erased at build.
	plugins: [adminClient(), inferAdditionalFields<Auth>()],
});

export const { signIn, signOut, signUp, useSession, getSession, admin } =
	authClient;
