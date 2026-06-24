import {
	buildOrderConfirmationEmail as buildBrandedOrderConfirmationEmail,
	type EmailMessage,
	getEmailSender,
} from "@workspace/auth";
import type { OrderConfirmationFacts } from "@workspace/core/commerce";
import type { OrderBillingAddressSnapshot } from "@workspace/db";
import { countryName } from "@/lib/site/countries";

const FALLBACK_IMAGE_URL =
	"https://alojamentoideal.pt/alojamento-ideal-logo.png";
const SITE_URL_FALLBACK = "https://alojamentoideal.pt";

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

function siteBaseUrl(): string {
	const configured =
		process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_AUTH_URL;
	if (!configured) {
		return SITE_URL_FALLBACK;
	}

	try {
		return new URL(configured).origin;
	} catch {
		return SITE_URL_FALLBACK;
	}
}

function manageUrl(publicReference: string): string {
	const url = new URL("/booking/complete", siteBaseUrl());
	url.searchParams.set("order", publicReference);
	return url.toString();
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
		manageUrl: manageUrl(facts.publicReference),
		orderNumber: facts.publicReference,
		paymentMethod: "Online payment",
		totalPrice: amount,
	});
}

/**
 * Sends the single order-confirmation email for a freshly confirmed order.
 * Callers must only invoke this on the first draft -> confirmed transition so a
 * re-delivered webhook never produces a duplicate email.
 */
export async function sendOrderConfirmationEmail(
	facts: OrderConfirmationFacts,
): Promise<void> {
	await getEmailSender().send({
		to: facts.email,
		...buildOrderConfirmationEmail(facts),
	});
}
