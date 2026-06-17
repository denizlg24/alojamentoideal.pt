import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

function resolveBaseURL(): string | undefined {
	if (typeof process !== "undefined") {
		return (
			process.env.NEXT_PUBLIC_AUTH_URL ??
			process.env.NEXT_PUBLIC_API_URL ??
			undefined
		);
	}

	return undefined;
}

export const authClient = createAuthClient({
	baseURL: resolveBaseURL(),
	plugins: [adminClient()],
});

export const { signIn, signOut, signUp, useSession, getSession, admin } =
	authClient;
