"use client";

import { PaymentElement } from "@stripe/react-stripe-js";

/**
 * Renders Stripe's hosted Payment Element. Stripe owns all sensitive card,
 * wallet and alternative-method UI (cards, Google Pay, MB WAY, PayPal) based on
 * what is enabled for the account; the app never collects PAN/CVC directly.
 * Confirmation is driven by the review step via `stripe.confirmPayment`.
 *
 * `onReady` fires once the Element has rendered and can accept input, letting
 * the caller keep a skeleton overlaid until then so the iframe's progressive
 * height growth does not shift the surrounding layout.
 */
export function CheckoutPaymentElement({ onReady }: { onReady?: () => void }) {
	return (
		<PaymentElement
			onReady={onReady}
			options={{
				fields: { billingDetails: "auto" },
				layout: { type: "tabs" },
			}}
		/>
	);
}
