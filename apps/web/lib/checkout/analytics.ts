import * as Sentry from "@sentry/nextjs";

/**
 * Consent-safe checkout analytics. Emitted as Sentry breadcrumbs so they ride
 * along with any error report without standing up a separate browser analytics
 * pipeline. NEVER pass names, emails, phones, tax numbers, addresses, card
 * details, client secrets or free-text notes here.
 */
export type CheckoutEventName =
	| "checkout_started"
	| "checkout_step_viewed"
	| "checkout_validation_failed"
	| "payment_failed"
	| "payment_started";

type SafeValue = boolean | number | string;
type CheckoutEventData = {
	currency?: string;
	listingId?: string;
	amountMinor?: number;
	kind?: string;
	step?: string;
};
export function trackCheckoutEvent(
	name: CheckoutEventName,
	data?: CheckoutEventData,
): void {
	Sentry.addBreadcrumb({
		category: "checkout",
		data: data as Record<string, SafeValue> | undefined,
		level: name.includes("failed") ? "warning" : "info",
		message: name,
	});
}
