import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import { sendOrderInviteEmail } from "@/lib/email/order-invite";

interface OrderGuestInviteRouteContext {
	params: Promise<{ bookingId: string; guestId: string; reference: string }>;
}

function readEmail(body: unknown): string | null {
	if (body && typeof body === "object" && "email" in body) {
		const value = (body as { email?: unknown }).email;
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return null;
}

/**
 * Invites a person to fill a specific guest slot (owner only). The invite binds
 * the slot at creation, so the owner no longer registers that guest and the
 * invitee lands on exactly this slot. A 24h magic-link token is emailed and
 * never returned to the browser.
 */
export const POST = withApiRoute<OrderGuestInviteRouteContext>(
	{ name: "orders.guest_invite", rateLimit: { bucket: "mutation" } },
	async (request: Request, context): Promise<Response> => {
		const { bookingId, guestId, reference } = await context.params;
		const email = readEmail(await readJson(request));
		if (!email) {
			return Response.json(
				{ code: "invalid_request", error: "An email address is required." },
				{ status: 400 },
			);
		}

		const accessContext = await resolveOrderAccessContext(request, reference);
		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const detail = await service.readOrderDetail(access);
			const accommodationTitle =
				detail.items.find((item) => item.providerBooking?.id === bookingId)
					?.title ??
				detail.items[0]?.title ??
				"your stay";
			const invite = await service.inviteGuest(
				access,
				{ bookingGuestId: guestId, email, providerBookingId: bookingId },
				({ email: to, token }) =>
					sendOrderInviteEmail({
						accommodationTitle,
						publicReference: access.order.publicReference,
						to,
						token,
					}),
			);
			return Response.json(
				{
					member: {
						email: invite.email,
						expiresAt: invite.expiresAt.toISOString(),
						id: invite.memberId,
						role: "member",
						status: "invited",
					},
				},
				{ status: 201 },
			);
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
