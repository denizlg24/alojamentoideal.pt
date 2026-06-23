"use client";

import { Button } from "@workspace/ui/components/button";
import { CheckoutStepCard, type StepCardState } from "./checkout-step-card";

interface PayTimingStepProps {
	onConfirm: () => void;
	onEdit: () => void;
	payNowLabel: string;
	state: StepCardState;
}

/**
 * Step 1: choose when to pay. Only "pay now" is offered. Installments are
 * intentionally absent until backed by a Stripe-supported method and an
 * approved business rule, sourced from server capability data.
 */
export function PayTimingStep({
	onConfirm,
	onEdit,
	payNowLabel,
	state,
}: PayTimingStepProps) {
	return (
		<CheckoutStepCard
			onEdit={onEdit}
			state={state}
			stepNumber={1}
			summary={`Pay ${payNowLabel} now`}
			title="Choose when to pay"
		>
			<div className="flex flex-col gap-4">
				<div className="flex items-center justify-between rounded-xl border-2 border-foreground px-4 py-3">
					<span className="font-medium">Pay {payNowLabel} now</span>
					<span
						aria-hidden
						className="flex size-5 items-center justify-center rounded-full border-2 border-foreground"
					>
						<span className="size-2.5 rounded-full bg-foreground" />
					</span>
				</div>
				<p className="text-muted-foreground text-sm">
					Pay the full amount today to confirm your stay. You won't be charged
					until you press "Confirm and pay".
				</p>
				<Button className="self-start" onClick={onConfirm} size="lg">
					Next
				</Button>
			</div>
		</CheckoutStepCard>
	);
}
