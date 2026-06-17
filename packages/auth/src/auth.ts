import { getDb, schema } from "@workspace/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { getAuthConfig } from "./config.js";
import { sendVerificationEmail } from "./email.js";

function createAuth() {
	const config = getAuthConfig();

	return betterAuth({
		appName: "Alojamento Ideal",
		baseURL: config.baseURL,
		basePath: "/api/auth",
		secret: config.secret,
		trustedOrigins: config.trustedOrigins,
		database: drizzleAdapter(getDb(), {
			provider: "pg",
			schema,
		}),
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: true,
		},
		emailVerification: {
			sendOnSignUp: true,
			autoSignInAfterVerification: true,
			sendVerificationEmail: async ({ user, url }) => {
				await sendVerificationEmail({ email: user.email, url });
			},
		},
		socialProviders: config.google ? { google: config.google } : {},
		plugins: [admin()],
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
export type AuthUser = Session["user"];

let authInstance: Auth | undefined;

export function getAuth(): Auth {
	authInstance ??= createAuth();

	return authInstance;
}

export const auth = new Proxy({} as Auth, {
	get(_target, property, receiver) {
		const value = Reflect.get(getAuth(), property, receiver);

		if (typeof value === "function") {
			return value.bind(getAuth());
		}

		return value;
	},
});
