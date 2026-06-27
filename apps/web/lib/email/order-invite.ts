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
