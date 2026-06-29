import {
	buildOrderConfirmationEmail as buildBrandedOrderConfirmationEmail,
	type EmailMessage,
	getEmailSender,
} from "@workspace/auth";
import {
	generateMemberToken,
	type OrderConfirmationFacts,
} from "@workspace/core/commerce";
import type { OrderBillingAddressSnapshot } from "@workspace/db";
import { commerceService } from "@/lib/api/commerce";
import { countryName } from "@/lib/site/countries";
import { orderHubUrl } from "./order-url";

const FALLBACK_IMAGE_URL =
	"https://alojamentoideal.pt/alojamento-ideal-logo.png";

/**
 * Formats a minor-unit amount for display in the confirmation email. The ISO
 * currency code drives the symbol and fraction digits via Intl, so zero- and
 * three-decimal currencies render correctly without bespoke division.
 */
function formatAmount(amountMinor: number, currency: string): string {
	const formatter = new Intl.NumberFormat("en", {
		currency,
		style: "currency",
	});
	const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
	return formatter.format(amountMinor / 10 ** fractionDigits);
}

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

function formatGuests(guests: number): string {
	if (guests <= 0) {
		return "To be confirmed";
	}
	return `${guests} ${guests === 1 ? "guest" : "guests"}`;
}

function stringPart(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: null;
}

function formatBillingAddress(address: OrderBillingAddressSnapshot): string {
	const cityLine = [address.postalCode, address.city]
		.map(stringPart)
		.filter((part): part is string => part !== null)
		.join(" ");
	const countryCode = stringPart(address.country);
	const parts = [
		stringPart(address.line1),
		stringPart(address.line2),
		cityLine || null,
		stringPart(address.region),
		// Stored as an ISO-2 code; show the readable country name. Older orders
		// stored the full name, which countryName passes through unchanged.
		countryCode ? countryName(countryCode) : null,
	].filter((part): part is string => part !== null);

	return parts.length > 0 ? parts.join(", ") : "Not provided";
}

export function buildOrderConfirmationEmail(
	facts: OrderConfirmationFacts,
	manageUrl: string,
): EmailMessage {
	const amount = formatAmount(facts.amountPaidMinor, facts.currency);

	return buildBrandedOrderConfirmationEmail({
		accommodationImage: facts.accommodationImage ?? FALLBACK_IMAGE_URL,
		accommodationTitle: facts.accommodationTitle,
		billingAddress: formatBillingAddress(facts.billingAddress),
		checkIn: formatDate(facts.checkIn),
		checkOut: formatDate(facts.checkOut),
		contactEmail: facts.email,
		contactPhone: facts.contactPhone || "Not provided",
		email: facts.email,
		guests: formatGuests(facts.guests),
		manageUrl,
		orderNumber: facts.publicReference,
		paymentMethod: "Online payment",
		totalPrice: amount,
	});
}

/**
 * Sends the single order-confirmation email for a freshly confirmed order.
 * Callers must only invoke this on the first pending -> confirmed transition so a
 * re-delivered webhook never produces a duplicate email. Provisioning the booker
 * as the order's `owner` member is bound here, the one guarded once-per-order
 * action both the webhook and the reconciler cron funnel through. The raw access
 * token is minted before sending so the "Manage reservation" CTA can carry it,
 * then activated only after the mail provider accepts the message; only its hash
 * is persisted.
 */
export async function sendOrderConfirmationEmail(
	facts: OrderConfirmationFacts,
): Promise<void> {
	const token = generateMemberToken();
	const manageUrl = orderHubUrl(facts.publicReference, token);
	await getEmailSender().send({
		to: facts.email,
		...buildOrderConfirmationEmail(facts, manageUrl),
	});
	await commerceService().activateOwnerAccessToken(
		facts.orderId,
		facts.email,
		token,
	);
}
