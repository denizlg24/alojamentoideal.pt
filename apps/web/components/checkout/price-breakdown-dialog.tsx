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
	items: CartItemDto[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
}

function ItemFeeLines({
	currency,
	item,
	showTitle,
}: {
	currency: string;
	item: CartItemDto;
	showTitle: boolean;
}) {
	const feeLines = item.quote.feeLines.filter((line) => line.totalMinor !== 0);
	return (
		<div className="flex flex-col gap-3">
			{showTitle && (
				<span className="line-clamp-1 font-medium">{item.title}</span>
			)}
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
		</div>
	);
}

/**
 * Itemized price breakdown for the whole cart: quote fee lines per stay, the
 * cart-level discount and the authoritative total.
 */
export function PriceBreakdownDialog({
	cart,
	items,
	onOpenChange,
	open,
}: PriceBreakdownDialogProps) {
	const currency = cart.currency;
	const discountLabel = cart.appliedDiscount?.promotionCode
		? `Discount (${cart.appliedDiscount.promotionCode})`
		: "Discount";

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-h-[80vh] overflow-y-auto rounded-2xl">
				<DialogHeader>
					<DialogTitle>Price details</DialogTitle>
					<DialogDescription>
						The full breakdown for{" "}
						{items.length === 1 ? "your stay" : "each of your stays"}, including
						taxes and any discount.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4 text-sm">
					{items.map((item, index) => (
						<div className="flex flex-col gap-3" key={item.id}>
							{index > 0 && <Separator />}
							<ItemFeeLines
								currency={currency}
								item={item}
								showTitle={items.length > 1}
							/>
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
