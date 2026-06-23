import type { Appearance } from "@stripe/stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";

/**
 * Lazily loads Stripe.js once per session. Returns `null` when the publishable
 * key is missing so the UI can show a configuration error instead of throwing.
 */
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
	if (stripePromise) {
		return stripePromise;
	}

	const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
	if (!publishableKey) {
		if (process.env.NODE_ENV !== "production") {
			console.error(
				"NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set. Stripe Elements will not load.",
			);
		}
		return Promise.resolve(null);
	}

	stripePromise = loadStripe(publishableKey);
	return stripePromise;
}

export function isStripeConfigured(): boolean {
	return Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
}

/**
 * Elements appearance aligned to the checkout shell: app font, rounded inputs
 * and a near-black accent (not Airbnb red). Kept here so both the wrapper and
 * any express-checkout element share one source of truth.
 */
export const checkoutAppearance: Appearance = {
	theme: "stripe",
	variables: {
		borderRadius: "12px",
		colorDanger: "#dc2626",
		colorPrimary: "#111827",
		fontFamily:
			'"Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, sans-serif',
		fontSizeBase: "15px",
		spacingUnit: "4px",
	},
};
