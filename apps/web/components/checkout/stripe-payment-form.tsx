"use client";

import { Elements } from "@stripe/react-stripe-js";
import type { StripeElementsOptions } from "@stripe/stripe-js";
import { useMemo } from "react";
import {
	checkoutAppearance,
	getStripe,
	isStripeConfigured,
} from "@/lib/checkout/stripe";
import { CheckoutAlert } from "./checkout-alert";

interface StripePaymentFormProps {
	children: React.ReactNode;
	clientSecret: string;
}

/**
 * Mounts Stripe Elements bound to a PaymentIntent client secret. The Stripe.js
 * promise is memoized in `getStripe`, so re-renders reuse one instance; only
 * the client secret changes when the order/PaymentIntent is refreshed. When the
 * publishable key is missing, Elements cannot load, so a clear configuration
 * notice is shown instead of a blank payment step.
 */
export function StripePaymentForm({
	children,
	clientSecret,
}: StripePaymentFormProps) {
	const options = useMemo<StripeElementsOptions>(
		() => ({ appearance: checkoutAppearance, clientSecret }),
		[clientSecret],
	);

	if (!isStripeConfigured()) {
		return (
			<CheckoutAlert title="Payments unavailable" variant="error">
				{process.env.NODE_ENV === "production"
					? "Payments are temporarily unavailable. Please try again shortly."
					: "Payments are not configured for this environment. Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to enable the payment step."}
			</CheckoutAlert>
		);
	}

	return (
		<Elements options={options} stripe={getStripe()}>
			{children}
		</Elements>
	);
}
