import { getDb, schema } from "@workspace/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { getAuthConfig } from "./config";
import { sendResetPasswordEmail, sendVerificationEmail } from "./email";

export function createAuth() {
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
			sendResetPassword: async ({ user, url }) => {
				await sendResetPasswordEmail({ email: user.email, url });
			},
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
