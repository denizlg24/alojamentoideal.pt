"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { ResponsiveSelect } from "@workspace/ui/components/responsive-select";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { formatMoneyMinor } from "@/lib/format";

interface RefundAttributionItem {
	amountMinor: number | null;
	id: string;
	/** Cancellation-policy hint for this item; null when not evaluable. */
	policyLabel: string | null;
	/** Policy-derived refund suggestion in minor units; advisory only. */
	policySuggestedAmountMinor: number | null;
	title: string;
}

interface RefundPanelProps {
	currency: string;
	items: RefundAttributionItem[];
	reference: string;
	refundableMinor: number;
}

const PRESETS = [25, 50, 100] as const;

const REASONS = [
	{ label: "Requested by customer", value: "requested_by_customer" },
	{ label: "Duplicate", value: "duplicate" },
	{ label: "Fraudulent", value: "fraudulent" },
	{ label: "Other", value: "other" },
] as const;

function presetAmountMinor(refundableMinor: number, percent: number): number {
	if (refundableMinor <= 0) {
		return 0;
	}
	if (percent >= 100) {
		return refundableMinor;
	}
	return Math.min(
		refundableMinor,
		Math.round((refundableMinor * percent) / 100),
	);
}

/** Parses a euros decimal string to integer minor units, or null when invalid. */
function eurosToMinor(value: string): number | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return null;
	}
	return Math.round(parsed * 100);
}

function minorToEuros(minor: number): string {
	return (minor / 100).toFixed(2);
}

/**
 * Operator-facing manual refund control. Presets are a percentage of the
 * amount still refundable; the amount stays fully editable. Attribution to a
 * single reservation is reporting-only — the money always moves against the
 * order's one PaymentIntent.
 */
export function RefundPanel({
	currency,
	items,
	reference,
	refundableMinor,
}: RefundPanelProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [amount, setAmount] = useState("");
	const [reason, setReason] = useState<string>("requested_by_customer");
	const [orderItemId, setOrderItemId] = useState<string>("");
	const [note, setNote] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	const amountMinor = useMemo(() => eurosToMinor(amount), [amount]);
	const overRefundable = amountMinor !== null && amountMinor > refundableMinor;
	const attributedItem = useMemo(
		() => items.find((item) => item.id === orderItemId) ?? null,
		[items, orderItemId],
	);
	const attributionOptions = [
		{ label: "Whole order", value: "" },
		...items.map((item) => ({
			label: `${item.title}${
				item.amountMinor !== null
					? ` · ${formatMoneyMinor(item.amountMinor, currency)}`
					: ""
			}`,
			value: item.id,
		})),
	];

	function reset() {
		setAmount("");
		setReason("requested_by_customer");
		setOrderItemId("");
		setNote("");
		setError(null);
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (amountMinor === null) {
			setError("Enter a refund amount greater than zero.");
			return;
		}
		if (amountMinor > refundableMinor) {
			setError(
				`Amount exceeds the ${formatMoneyMinor(refundableMinor, currency)} still refundable.`,
			);
			return;
		}

		startTransition(async () => {
			setError(null);
			const response = await fetch(
				`/api/admin/orders/${encodeURIComponent(reference)}/refunds`,
				{
					body: JSON.stringify({
						amountMinor,
						note: note.trim() || undefined,
						orderItemId: orderItemId || undefined,
						reason,
					}),
					headers: { "content-type": "application/json" },
					method: "POST",
				},
			);
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					error?: string;
				} | null;
				setError(body?.error ?? "Could not issue the refund.");
				return;
			}
			const body = (await response.json().catch(() => null)) as {
				data?: { transferReversalError?: string };
			} | null;
			toast.success(
				`Refunded ${formatMoneyMinor(amountMinor, currency)} to the guest.`,
			);
			if (body?.data?.transferReversalError) {
				toast.warning(
					`Detours transfer reversal failed: ${body.data.transferReversalError}. Reverse it manually in Stripe.`,
				);
			}
			setOpen(false);
			reset();
			router.refresh();
		});
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					reset();
				}
			}}
			open={open}
		>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline">
					Issue refund
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Issue a refund</DialogTitle>
					<DialogDescription>
						{formatMoneyMinor(refundableMinor, currency)} still refundable on
						this order. Refunds move money only; they do not cancel the
						reservation.
					</DialogDescription>
				</DialogHeader>
				<form className="space-y-4" onSubmit={handleSubmit}>
					<div className="flex flex-wrap gap-2">
						{PRESETS.map((percent) => (
							<Button
								key={percent}
								onClick={() =>
									setAmount(
										minorToEuros(presetAmountMinor(refundableMinor, percent)),
									)
								}
								size="sm"
								type="button"
								variant="secondary"
							>
								{percent}%
							</Button>
						))}
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="refund-amount">Amount ({currency})</Label>
						<Input
							id="refund-amount"
							inputMode="decimal"
							onChange={(event) => setAmount(event.target.value)}
							placeholder="0.00"
							value={amount}
						/>
						{overRefundable ? (
							<p className="text-destructive text-xs">
								Exceeds the refundable amount.
							</p>
						) : null}
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="refund-reason">Reason</Label>
						<ResponsiveSelect
							className="w-full"
							id="refund-reason"
							onValueChange={setReason}
							options={REASONS}
							value={reason}
						/>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="refund-attribution">Attribute to</Label>
						<ResponsiveSelect
							className="w-full"
							id="refund-attribution"
							onValueChange={setOrderItemId}
							options={attributionOptions}
							value={orderItemId}
						/>
						{attributedItem?.policyLabel ? (
							<div className="flex flex-wrap items-center gap-2 pt-0.5">
								<p className="text-muted-foreground text-xs">
									{attributedItem.policyLabel}
								</p>
								{attributedItem.policySuggestedAmountMinor !== null &&
								attributedItem.policySuggestedAmountMinor > 0 ? (
									<Button
										onClick={() =>
											setAmount(
												minorToEuros(
													Math.min(
														attributedItem.policySuggestedAmountMinor ?? 0,
														refundableMinor,
													),
												),
											)
										}
										size="sm"
										type="button"
										variant="secondary"
									>
										Use{" "}
										{formatMoneyMinor(
											Math.min(
												attributedItem.policySuggestedAmountMinor,
												refundableMinor,
											),
											currency,
										)}
									</Button>
								) : null}
							</div>
						) : null}
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="refund-note">Note (optional)</Label>
						<Input
							id="refund-note"
							maxLength={500}
							onChange={(event) => setNote(event.target.value)}
							placeholder="Internal reference"
							value={note}
						/>
					</div>

					{error ? <p className="text-destructive text-sm">{error}</p> : null}

					<DialogFooter>
						<Button
							onClick={() => setOpen(false)}
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button disabled={pending || overRefundable} type="submit">
							{pending ? "Refunding…" : "Issue refund"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
