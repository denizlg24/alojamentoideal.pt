"use client";

import { PaymentElement } from "@stripe/react-stripe-js";

/**
 * Renders Stripe's hosted Payment Element. Stripe owns all sensitive card,
 * wallet and alternative-method UI (cards, Google Pay, MB WAY, PayPal) based on
 * what is enabled for the account; the app never collects PAN/CVC directly.
 * Confirmation is driven by the review step via `stripe.confirmPayment`.
 */
export function CheckoutPaymentElement() {
	return (
		<PaymentElement
			options={{
				fields: { billingDetails: "auto" },
				layout: { type: "tabs" },
			}}
		/>
	);
}
