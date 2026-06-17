import { getDb, schema } from "@workspace/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { getAuthConfig } from "./config.js";
import { sendVerificationEmail } from "./email.js";

const config = getAuthConfig();

export const auth = betterAuth({
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

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
export type AuthUser = Session["user"];
