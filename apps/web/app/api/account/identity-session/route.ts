import {
	createIdentityVerificationSession,
	createStripeClientFromEnv,
	resetIdentityVerificationSession,
	StripeConfigurationError,
} from "@workspace/core/integrations/stripe";
import { hashIdentifier, logger } from "@workspace/core/observability";
import { accountProfileRepository } from "@/lib/api/account";
import { withApiRoute } from "@/lib/api/route";
import { getServerUser } from "@/lib/auth/session";
import { siteConfig } from "@/lib/site/config";

function stripeSessionLogId(sessionId: string): string {
	return hashIdentifier(`stripe-identity:${sessionId}`);
}

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

		const returnUrl = new URL(
			"/account?identity=complete",
			siteConfig.url,
		).toString();
		const session = await createIdentityVerificationSession(stripe, {
			idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined,
			userId: user.id,
			returnUrl,
		});

		try {
			await accountProfileRepository().linkIdentitySession(
				user.id,
				session.id,
				session.status,
			);
		} catch (error) {
			try {
				await resetIdentityVerificationSession(stripe, {
					sessionId: session.id,
					status: session.status,
				});
			} catch (cleanupError) {
				logger.warn("Stripe identity session cleanup failed", {
					error:
						cleanupError instanceof Error
							? cleanupError.message
							: String(cleanupError),
					sessionIdHash: stripeSessionLogId(session.id),
					status: session.status,
				});
			}
			throw error;
		}

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
						sessionIdHash: stripeSessionLogId(
							target.stripeVerificationSessionId,
						),
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
