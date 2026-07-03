"use client";

import { Checkbox } from "@workspace/ui/components/checkbox";
import { Label } from "@workspace/ui/components/label";
import { Separator } from "@workspace/ui/components/separator";
import type { ReactNode } from "react";
import { CheckoutAlert } from "./checkout-alert";
import { CheckoutStepCard, type StepCardState } from "./checkout-step-card";

interface ReviewReservationStepProps {
	cancellationSummary: string;
	confirmSlot: ReactNode;
	contactSummary: ReactNode;
	error: string | null;
	/** Pluralizes the stay wording when the order holds several bookings. */
	multipleStays?: boolean;
	onEdit: () => void;
	onTermsChange: (accepted: boolean) => void;
	paymentSummary: string;
	state: StepCardState;
	staySummary: ReactNode;
	termsAccepted: boolean;
}

function ReviewBlock({
	children,
	title,
}: {
	children: ReactNode;
	title: string;
}) {
	return (
		<div className="flex flex-col gap-1">
			<span className="font-medium text-sm">{title}</span>
			<div className="text-muted-foreground text-sm">{children}</div>
		</div>
	);
}

/** Step 3: final review, booking terms and the confirm-and-pay control. */
export function ReviewReservationStep({
	cancellationSummary,
	confirmSlot,
	contactSummary,
	error,
	multipleStays = false,
	onEdit,
	onTermsChange,
	paymentSummary,
	state,
	staySummary,
	termsAccepted,
}: ReviewReservationStepProps) {
	return (
		<CheckoutStepCard
			onEdit={onEdit}
			state={state}
			stepNumber={3}
			title="Review your reservation"
		>
			<div className="flex flex-col gap-5">
				<ReviewBlock title={multipleStays ? "Your stays" : "Your stay"}>
					{staySummary}
				</ReviewBlock>
				<Separator />
				<ReviewBlock title="Contact">{contactSummary}</ReviewBlock>
				<Separator />
				<ReviewBlock title="Payment">{paymentSummary}</ReviewBlock>
				<Separator />
				<ReviewBlock title="Cancellation and refunds">
					{cancellationSummary}
				</ReviewBlock>

				<div className="flex items-start gap-2.5">
					<Checkbox
						checked={termsAccepted}
						className="mt-0.5"
						id="checkout-terms"
						onCheckedChange={(checked) => onTermsChange(checked === true)}
					/>
					<Label
						className="font-normal text-sm leading-snug"
						htmlFor="checkout-terms"
					>
						I agree to the booking terms and the cancellation policy for{" "}
						{multipleStays ? "these stays" : "this stay"} with Alojamento Ideal.
					</Label>
				</div>

				{error && <CheckoutAlert variant="error">{error}</CheckoutAlert>}

				<div className="flex flex-col gap-2">
					{confirmSlot}
					<p className="text-muted-foreground text-xs">
						Your reservation is confirmed once payment is received and the
						Alojamento Ideal team completes your booking.
					</p>
				</div>
			</div>
		</CheckoutStepCard>
	);
}
