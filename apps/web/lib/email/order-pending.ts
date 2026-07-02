import {
	buildOrderPendingConfirmationEmail,
	getEmailSender,
} from "@workspace/auth";
import {
	generateMemberToken,
	type OrderConfirmationFacts,
} from "@workspace/core/commerce";
import { commerceService } from "@/lib/api/commerce";
import { toOrderEmailInput } from "./order-confirmation";
import { orderHubUrl } from "./order-url";

/**
 * Sends the "payment received, we're finalizing your booking" email while an
 * order sits paid but not yet confirmed. Mirrors the confirmation email: it mints
 * and activates a fresh owner access token so the "track your booking" CTA lands
 * on the order hub, then rotates when the later confirmation email sends. Callers
 * must guard invocation with `claimPendingNoticeEmail` so a re-delivered webhook
 * and the reconciler never double-send.
 */
export async function sendOrderPendingConfirmationEmail(
	facts: OrderConfirmationFacts,
): Promise<void> {
	if (!facts.email) {
		return;
	}
	const token = generateMemberToken();
	await commerceService().activateOwnerAccessToken(
		facts.orderId,
		facts.email,
		token,
	);
	const manageUrl = orderHubUrl(facts.publicReference, token);
	await getEmailSender().send({
		to: facts.email,
		...buildOrderPendingConfirmationEmail(toOrderEmailInput(facts, manageUrl)),
	});
}
