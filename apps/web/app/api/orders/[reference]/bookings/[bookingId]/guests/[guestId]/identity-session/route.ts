import {
	createGuestIdentityVerificationSession,
	createStripeClientFromEnv,
	resetIdentityVerificationSession,
	StripeConfigurationError,
} from "@workspace/core/integrations/stripe";
import { hashIdentifier, logger } from "@workspace/core/observability";
import {
	commerceErrorResponse,
	commerceService,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import { siteConfig } from "@/lib/site/config";

interface OrderGuestIdentitySessionRouteContext {
	params: Promise<{ bookingId: string; guestId: string; reference: string }>;
}

function stripeSessionLogId(sessionId: string): string {
	return hashIdentifier(`stripe-identity:${sessionId}`);
}

/**
 * Starts Stripe Identity for a booking guest. Authorization is scoped through
 * the order access spine; members can only start a session for their own claimed
 * guest slot, while the owner can manage all guest slots.
 */
export const POST = withApiRoute<OrderGuestIdentitySessionRouteContext>(
	{
		name: "orders.booking_guest_identity_session",
		rateLimit: { bucket: "mutation" },
	},
	async (request: Request, context): Promise<Response> => {
		const { bookingId, guestId, reference } = await context.params;
		const accessContext = await resolveOrderAccessContext(request, reference);

		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);

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

			const target = await service.prepareBookingGuestIdentitySession(
				access,
				bookingId,
				guestId,
			);
			const returnUrl = new URL(
				`/order/${encodeURIComponent(reference)}?identity=complete`,
				siteConfig.url,
			).toString();
			const session = await createGuestIdentityVerificationSession(stripe, {
				bookingGuestId: target.bookingGuestId,
				orderId: target.orderId,
				providerBookingId: target.providerBookingId,
				returnUrl,
			});

			try {
				await service.linkBookingGuestIdentitySession(
					target.bookingGuestId,
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
					logger.warn("Stripe guest identity session cleanup failed", {
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
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
