import {
	buildOrderAmountMismatchRefundEmail,
	buildOrderCouldNotConfirmEmail,
	type EmailMessage,
	getEmailSender,
	type OrderCompensationEmailInput,
} from "@workspace/auth";
import type { OrderCompensationFacts } from "@workspace/core/commerce";

const SITE_URL_FALLBACK = "https://alojamentoideal.pt";

/**
 * Formats a minor-unit amount with the right fraction digits for its currency.
 * Mirrors the confirmation email so the two render consistently.
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

function browseUrl(): string {
	return new URL("/homes", siteBaseUrl()).toString();
}

function compensationInput(
	facts: OrderCompensationFacts,
): OrderCompensationEmailInput {
	return {
		browseUrl: browseUrl(),
		greeting: facts.name ? `Hi ${facts.name},` : "Hi there,",
		orderNumber: facts.publicReference,
		refundAmount: formatAmount(facts.amountRefundedMinor, facts.currency),
	};
}

export function buildOrderCouldNotConfirmEmailMessage(
	facts: OrderCompensationFacts,
): EmailMessage {
	return buildOrderCouldNotConfirmEmail(compensationInput(facts));
}

export function buildOrderAmountMismatchRefundEmailMessage(
	facts: OrderCompensationFacts,
): EmailMessage {
	return buildOrderAmountMismatchRefundEmail(compensationInput(facts));
}

/**
 * Sends the compensation email. Callers must only invoke this on the transition
 * into `cancelled` (from durable state), so a re-run never re-emails.
 */
export async function sendOrderCouldNotConfirmEmail(
	facts: OrderCompensationFacts,
): Promise<void> {
	if (!facts.email) {
		return;
	}
	await getEmailSender().send({
		to: facts.email,
		...buildOrderCouldNotConfirmEmailMessage(facts),
	});
}

export async function sendOrderAmountMismatchRefundEmail(
	facts: OrderCompensationFacts,
): Promise<void> {
	if (!facts.email) {
		return;
	}
	await getEmailSender().send({
		to: facts.email,
		...buildOrderAmountMismatchRefundEmailMessage(facts),
	});
}

export async function sendOrderCompensationEmail(
	facts: OrderCompensationFacts,
): Promise<void> {
	if (facts.emailKind === "refund_amount_mismatch") {
		await sendOrderAmountMismatchRefundEmail(facts);
		return;
	}
	await sendOrderCouldNotConfirmEmail(facts);
}
