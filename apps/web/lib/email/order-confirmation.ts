import {
	buildOrderConfirmationEmail as buildBrandedOrderConfirmationEmail,
	type EmailMessage,
	getEmailSender,
	type OrderConfirmationEmailInput,
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

function titleCasePaymentPart(value: string): string {
	return value
		.split(/[_\s-]+/)
		.filter(Boolean)
		.map(
			(part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`,
		)
		.join(" ");
}

function formatPaymentMethod(method: OrderConfirmationFacts["paymentMethod"]): {
	cardLastFour?: string;
	label: string;
} {
	if (!method) {
		return { label: "Online payment" };
	}
	if (method.type === "card") {
		return {
			cardLastFour: method.last4 ?? undefined,
			label: method.brand ? titleCasePaymentPart(method.brand) : "Card",
		};
	}
	return { label: titleCasePaymentPart(method.type) || "Online payment" };
}

/**
 * Maps the durable order facts to the transport-layer email input, formatting
 * money, dates and the payment method for display. Shared by the confirmation
 * and pending-notice emails so both render identical booking details.
 */
export function toOrderEmailInput(
	facts: OrderConfirmationFacts,
	manageUrl: string,
): OrderConfirmationEmailInput {
	const paymentMethod = formatPaymentMethod(facts.paymentMethod);

	return {
		accommodationImage: facts.accommodationImage ?? FALLBACK_IMAGE_URL,
		accommodationTitle: facts.accommodationTitle,
		billingAddress: formatBillingAddress(facts.billingAddress),
		cardLastFour: paymentMethod.cardLastFour,
		checkIn: formatDate(facts.checkIn),
		checkOut: formatDate(facts.checkOut),
		contactEmail: facts.email,
		contactPhone: facts.contactPhone || "Not provided",
		email: facts.email,
		guests: formatGuests(facts.guests),
		manageUrl,
		orderNumber: facts.publicReference,
		paymentMethod: paymentMethod.label,
		totalPrice: formatAmount(facts.amountPaidMinor, facts.currency),
	};
}

export function buildOrderConfirmationEmail(
	facts: OrderConfirmationFacts,
	manageUrl: string,
): EmailMessage {
	return buildBrandedOrderConfirmationEmail(
		toOrderEmailInput(facts, manageUrl),
	);
}

/**
 * Sends the single order-confirmation email for a freshly confirmed order.
 * Callers must only invoke this on the first pending -> confirmed transition so a
 * re-delivered webhook never produces a duplicate email. Provisioning the booker
 * as the order's `owner` member is bound here, the one guarded once-per-order
 * action both the webhook and the reconciler cron funnel through. The raw access
 * token is activated before sending so an accepted email never carries a dead
 * "Manage reservation" CTA; only its hash is persisted.
 */
export async function sendOrderConfirmationEmail(
	facts: OrderConfirmationFacts,
): Promise<void> {
	const token = generateMemberToken();
	await commerceService().activateOwnerAccessToken(
		facts.orderId,
		facts.email,
		token,
	);
	const manageUrl = orderHubUrl(facts.publicReference, token);
	await getEmailSender().send({
		to: facts.email,
		...buildOrderConfirmationEmail(facts, manageUrl),
	});
}
