"use client";

import { useElements, useStripe } from "@stripe/react-stripe-js";
import { Button } from "@workspace/ui/components/button";
import { useState } from "react";
import { usePendingMessages } from "./use-pending-messages";

/**
 * Escalating reassurance while `confirmPayment` runs. Banks and wallets can take
 * several seconds (and SCA longer), so the copy reassures the guest rather than
 * leaving a static spinner. Module-level so the cycling timer stays stable.
 */
const CONFIRMING_MESSAGES = [
	"Confirming your payment",
	"Securing your payment, this can take a few seconds",
	"Almost there, please keep this page open",
] as const;

type ConfirmPhase = "confirming" | "idle" | "validating";

interface ConfirmPayButtonProps {
	disabled: boolean;
	onError: (message: string) => void;
	/** Validate cart freshness before charging. Returns false to abort. */
	onValidate: () => Promise<boolean>;
	returnUrl: string;
	totalLabel: string;
}

/**
 * Final "Confirm and pay" control. Must render inside `<Elements>` because it
 * drives `stripe.confirmPayment`. With `redirect: "if_required"` normal cards
 * settle in-page; SCA/redirect methods send the visitor to `return_url`, where
 * `/booking/complete` verifies status server-side.
 */
export function ConfirmPayButton({
	disabled,
	onError,
	onValidate,
	returnUrl,
	totalLabel,
}: ConfirmPayButtonProps) {
	const stripe = useStripe();
	const elements = useElements();
	const [phase, setPhase] = useState<ConfirmPhase>("idle");
	const cyclingMessage = usePendingMessages(
		phase === "confirming",
		CONFIRMING_MESSAGES,
	);
	const pending = phase !== "idle";

	const handleClick = async () => {
		if (!stripe || !elements) {
			onError("Payment is still loading. Please try again in a moment.");
			return;
		}

		setPhase("validating");
		try {
			const fresh = await onValidate();
			if (!fresh) {
				setPhase("idle");
				return;
			}

			setPhase("confirming");
			const { error } = await stripe.confirmPayment({
				confirmParams: { return_url: returnUrl },
				elements,
				redirect: "if_required",
			});

			if (error) {
				onError(
					error.message ??
						"We could not confirm your payment. Please try again.",
				);
				setPhase("idle");
				return;
			}

			// No error and no redirect: payment is processing or succeeded. The
			// completion page verifies the real status server-side.
			window.location.assign(returnUrl);
		} catch (error) {
			onError(
				error instanceof Error
					? error.message
					: "We could not confirm your payment. Please try again.",
			);
			setPhase("idle");
		}
	};

	const label =
		phase === "idle"
			? `Confirm and pay ${totalLabel}`
			: phase === "validating"
				? "Checking your reservation"
				: cyclingMessage;

	return (
		<Button
			className="w-full sm:w-auto"
			disabled={disabled || pending || !stripe}
			onClick={handleClick}
			size="lg"
		>
			{label}
		</Button>
	);
}
