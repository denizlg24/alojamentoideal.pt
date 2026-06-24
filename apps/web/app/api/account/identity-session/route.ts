import {
	createIdentityVerificationSession,
	createStripeClientFromEnv,
	resetIdentityVerificationSession,
	StripeConfigurationError,
} from "@workspace/core/integrations/stripe";
import { logger } from "@workspace/core/observability";
import { accountProfileRepository } from "@/lib/api/account";
import { withApiRoute } from "@/lib/api/route";
import { getServerUser } from "@/lib/auth/session";

/**
 * Starts a Stripe Identity verification for the signed-in user and returns the
 * client secret the browser uses to open the verification modal. The created
 * session id is linked to an account identity document row so the webhook can
 * attribute the outcome back; the final status is authoritative from the
 * webhook, never the client.
 */
export const POST = withApiRoute(
	{ name: "account.identity.session", rateLimit: { bucket: "auth" } },
	async (request: Request): Promise<Response> => {
		const user = await getServerUser(request);
		if (!user) {
			return new Response(null, { status: 401 });
		}

		let stripe: ReturnType<typeof createStripeClientFromEnv>;
		try {
			stripe = createStripeClientFromEnv();
		} catch (error) {
			if (error instanceof StripeConfigurationError) {
				return Response.json(
					{
						code: "identity_unavailable",
						error: "Identity verification is not available right now.",
					},
					{ status: 503 },
				);
			}
			throw error;
		}

		const origin = new URL(request.url).origin;
		const session = await createIdentityVerificationSession(stripe, {
			userId: user.id,
			returnUrl: `${origin}/account?identity=complete`,
		});

		await accountProfileRepository().linkIdentitySession(
			user.id,
			session.id,
			session.status,
		);

		return Response.json({
			clientSecret: session.clientSecret,
			status: session.status,
		});
	},
);

/**
 * Resets the signed-in user's account identity flow and deletes locally stored
 * encrypted identity details. Stripe redaction is attempted before local
 * deletion when the session state supports it, but local deletion is not blocked
 * by Stripe configuration or lifecycle limitations.
 */
export const DELETE = withApiRoute(
	{ name: "account.identity.reset", rateLimit: { bucket: "auth" } },
	async (request: Request): Promise<Response> => {
		const user = await getServerUser(request);
		if (!user) {
			return new Response(null, { status: 401 });
		}

		const repository = accountProfileRepository();
		const targets = await repository.listIdentityResetTargets(user.id);

		let stripe: ReturnType<typeof createStripeClientFromEnv> | null = null;
		if (targets.some((target) => target.stripeVerificationSessionId)) {
			try {
				stripe = createStripeClientFromEnv();
			} catch (error) {
				if (error instanceof StripeConfigurationError) {
					logger.warn(
						"Stripe identity reset skipped; Stripe is not configured",
					);
				} else {
					throw error;
				}
			}
		}

		if (stripe) {
			for (const target of targets) {
				if (!target.stripeVerificationSessionId) {
					continue;
				}
				try {
					await resetIdentityVerificationSession(stripe, {
						sessionId: target.stripeVerificationSessionId,
						status: target.status,
					});
				} catch (error) {
					logger.warn("Stripe identity reset failed; deleting local data", {
						error: error instanceof Error ? error.message : String(error),
						sessionId: target.stripeVerificationSessionId,
						status: target.status,
					});
				}
			}
		}

		await repository.deleteIdentityDocumentsForUser(user.id);
		const profile = await repository.getProfile(user.id);

		return Response.json(profile);
	},
);
