import { CART_COOKIE_NAME, cart, getDb, schema } from "@workspace/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { and, eq, isNull } from "drizzle-orm";
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
		databaseHooks: {
			session: {
				create: {
					// Opportunistically merge the visitor's anonymous cart into the
					// account on login/sign-up. The /api/cart/claim endpoint is the
					// resilient path; both converge on identical claim SQL.
					after: async (session, context) => {
						const cartToken = context?.getCookie(CART_COOKIE_NAME);
						if (!cartToken) {
							return;
						}

						try {
							await getDb()
								.update(cart)
								.set({ updatedAt: new Date(), userId: session.userId })
								.where(
									and(
										eq(cart.cartToken, cartToken),
										isNull(cart.userId),
										eq(cart.status, "draft"),
									),
								);
						} catch (error) {
							// Opportunistic only: a failed merge must never block login. The
							// /api/cart/claim endpoint reconciles on the next request.
							console.error("Failed to merge anonymous cart on login", error);
						}
					},
				},
			},
		},
		plugins: [admin()],
	});
}

export type Auth = ReturnType<typeof createAuth>;
