"use client";

import type { ReactNode } from "react";
import { CheckoutStepCard, type StepCardState } from "./checkout-step-card";

interface PaymentMethodStepProps {
	children: ReactNode;
	onEdit: () => void;
	state: StepCardState;
	summary?: ReactNode;
}

/**
 * Step 2 shell: contact capture then the embedded Stripe Payment Element. The
 * controller supplies the body (contact form, Elements, or a zero-total note)
 * because the Elements provider must wrap both this step and the review step.
 */
export function PaymentMethodStep({
	children,
	onEdit,
	state,
	summary,
}: PaymentMethodStepProps) {
	return (
		<CheckoutStepCard
			onEdit={onEdit}
			state={state}
			stepNumber={2}
			summary={summary}
			title="Add a payment method"
		>
			{children}
		</CheckoutStepCard>
	);
}
