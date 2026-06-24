"use client";

import type { CartDto, CartItemDto } from "@workspace/core/commerce";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Separator } from "@workspace/ui/components/separator";
import { formatMinor } from "@/lib/checkout/format";

interface PriceBreakdownDialogProps {
	cart: CartDto;
	item: CartItemDto;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}

/** Itemized price breakdown: quote fee lines, discount and authoritative total. */
export function PriceBreakdownDialog({
	cart,
	item,
	onOpenChange,
	open,
}: PriceBreakdownDialogProps) {
	const currency = cart.currency;
	const feeLines = item.quote.feeLines.filter((line) => line.totalMinor !== 0);
	const discountLabel = cart.appliedDiscount?.promotionCode
		? `Discount (${cart.appliedDiscount.promotionCode})`
		: "Discount";

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="rounded-2xl">
				<DialogHeader>
					<DialogTitle>Price details</DialogTitle>
					<DialogDescription>
						The full breakdown for your stay, including taxes and any discount.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-3 text-sm">
					{feeLines.map((line, index) => (
						<div
							className="flex items-center justify-between gap-3"
							// biome-ignore lint/suspicious/noArrayIndexKey: fee names can repeat
							key={`${line.name}-${index}`}
						>
							<span className="text-muted-foreground">
								{line.name}
								{line.chargeLabel && (
									<span className="text-muted-foreground/70">
										{" "}
										· {line.chargeLabel}
									</span>
								)}
							</span>
							<span>{formatMinor(line.totalMinor, currency)}</span>
						</div>
					))}
					{cart.discountMinor > 0 && (
						<div className="flex items-center justify-between gap-3 text-emerald-700 dark:text-emerald-400">
							<span>{discountLabel}</span>
							<span>-{formatMinor(cart.discountMinor, currency)}</span>
						</div>
					)}
					<Separator />
					<div className="flex items-center justify-between gap-3 font-semibold text-base">
						<span>Total</span>
						<span>{formatMinor(cart.totalMinor, currency)}</span>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
