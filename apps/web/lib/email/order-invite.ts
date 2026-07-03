import { buildOrderInviteEmail, getEmailSender } from "@workspace/auth";
import { INVITE_TOKEN_TTL_MS } from "@workspace/core/commerce";
import { orderHubUrl } from "./order-url";

/** Derived from the token TTL so the copy never drifts from the real expiry. */
const INVITE_EXPIRES_IN_HOURS = Math.round(
	INVITE_TOKEN_TTL_MS / (60 * 60 * 1000),
);

export interface OrderInviteEmailParams {
	accommodationTitle: string;
	publicReference: string;
	to: string;
	token: string;
}

/**
 * Display title for an order-level invite: the stay title, or "X and 2 more
 * stays" when the order holds several bookings.
 */
export function orderInviteTitle(
	items: ReadonlyArray<{ title: string }>,
): string {
	const [first, ...rest] = items;
	if (!first) {
		return "your stay";
	}
	if (rest.length === 0) {
		return first.title;
	}
	return `${first.title} and ${rest.length} more ${rest.length === 1 ? "stay" : "stays"}`;
}

/**
 * Sends the magic-link invite for an order. The raw token is single-use and
 * short-lived; it is embedded in the hub URL and never persisted in raw form.
 */
export async function sendOrderInviteEmail(
	params: OrderInviteEmailParams,
): Promise<void> {
	await getEmailSender().send({
		to: params.to,
		...buildOrderInviteEmail({
			accommodationTitle: params.accommodationTitle,
			expiresInHours: INVITE_EXPIRES_IN_HOURS,
			inviteUrl: orderHubUrl(params.publicReference, params.token),
			orderNumber: params.publicReference,
		}),
	});
}
