import { buildOrderGuestReminderEmail, getEmailSender } from "@workspace/auth";
import { generateMemberToken } from "@workspace/core/commerce";
import type { GuestInfoReminderFacts } from "@workspace/core/compliance";
import { commerceService } from "@/lib/api/commerce";
import { orderHubUrl } from "./order-url";

function formatDate(value: string): string {
	const date = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(date.getTime())) {
		return value;
	}

	return new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
		year: "numeric",
	}).format(date);
}

export async function sendGuestInfoReminderEmail(
	facts: GuestInfoReminderFacts,
): Promise<void> {
	if (!facts.email) {
		return;
	}

	const token = generateMemberToken();
	await (await commerceService()).activateOwnerAccessToken(
		facts.orderId,
		facts.email,
		token,
	);

	await getEmailSender().send({
		to: facts.email,
		...buildOrderGuestReminderEmail({
			accommodationTitle: facts.accommodationTitle,
			checkIn: formatDate(facts.checkIn),
			checkOut: formatDate(facts.checkOut),
			manageUrl: orderHubUrl(facts.publicReference, token),
			missingGuestCount: facts.missingGuestCount,
			orderNumber: facts.publicReference,
			totalGuestCount: facts.totalGuestCount,
		}),
	});
}
