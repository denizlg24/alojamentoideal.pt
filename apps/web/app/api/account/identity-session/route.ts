import {
	createIdentityVerificationSession,
	createStripeClientFromEnv,
	StripeConfigurationError,
} from "@workspace/core/integrations/stripe";
import { accountProfileRepository } from "@/lib/api/account";
import { withApiRoute } from "@/lib/api/route";
import { getServerUser } from "@/lib/auth/session";

/**
 * Starts a Stripe Identity verification for the signed-in user and returns the
 * client secret the browser uses to open the verification modal. The created
 * session id is linked to the user's profile so the webhook can attribute the
 * outcome back; the final status is authoritative from the webhook, never the
 * client.
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
