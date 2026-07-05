import z from "zod";
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

const inviteEmailSchema = z.object({ email: z.email() });

function readEmail(body: unknown): string | null {
	const parsed = inviteEmailSchema.safeParse(body);
	return parsed.success ? parsed.data.email.trim() : null;
}

/**
 * Invites a person to fill a specific guest slot (owner only). The invite binds
 * the slot at creation, so the owner no longer registers that guest and the
 * invitee lands on exactly this slot. A 24h magic-link token is emailed and
 * never returned to the browser. An email already on the order (invited to
 * another stay of a multi-booking order) joins through its existing membership
 * and sees every stay bound to it; an already-active member gains the slot
 * silently, with no new link.
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
			const service = await commerceService();
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
						expiresAt: invite.expiresAt ? invite.expiresAt.toISOString() : null,
						id: invite.memberId,
						role: "member",
						status: invite.status,
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
