"use client";

import type { CartDto, CartItemDto } from "@workspace/core/commerce";
import { Button } from "@workspace/ui/components/button";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import {
	formatMinor,
	formatStayRange,
	guestSummaryLabel,
	nightsLabel,
} from "@/lib/checkout/format";

interface CartSummaryProps {
	/** Enables the "Edit cart" link; off once the cart is frozen into an order. */
	canEditCart: boolean;
	canOpenPriceDetails: boolean;
	cart: CartDto | null;
	discountSlot?: ReactNode;
	/** Item id allowed to edit dates/guests inline (single-stay checkout). */
	editableItemId?: string | null;
	items: CartItemDto[];
	onEditStay?: (item: CartItemDto) => void;
	onOpenCurrency: () => void;
	onOpenPriceDetails: () => void;
	/** Items whose price is being re-quoted after an optimistic edit. */
	repricingItemIds?: Set<string>;
}

function SummaryItemRow({
	item,
	onEdit,
	repricing,
}: {
	item: CartItemDto;
	onEdit?: () => void;
	repricing: boolean;
}) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex gap-3">
				<div className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
					{item.imageUrl && (
						<Image
							alt={item.title}
							className="size-full object-cover"
							height={56}
							src={item.imageUrl}
							width={56}
						/>
					)}
				</div>
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="line-clamp-1 font-medium text-sm">{item.title}</span>
					<span className="text-muted-foreground text-xs">
						{formatStayRange(item.checkIn, item.checkOut)} ·{" "}
						{nightsLabel(item.nights)}
					</span>
					<span className="text-muted-foreground text-xs">
						{guestSummaryLabel({
							adults: item.adults,
							children: item.children,
							infants: item.infants,
						})}
					</span>
				</div>
				{repricing ? (
					<Skeleton className="h-4 w-16 shrink-0" />
				) : (
					<span className="shrink-0 font-medium text-sm">
						{formatMinor(item.totalMinor, item.currency)}
					</span>
				)}
			</div>
			{onEdit && (
				<div className="pl-[68px]">
					<button
						className="text-muted-foreground text-xs underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
						disabled={repricing}
						onClick={onEdit}
						type="button"
					>
						Edit stay
					</button>
				</div>
			)}
		</div>
	);
}

/**
 * Sticky checkout summary for the shared cart: every stay in the order, the
 * price roll-up, discount entry and the currency/price-details dialogs. Item
 * edits happen on the cart page, so this stays read-only.
 */
export function CartSummary({
	canEditCart,
	canOpenPriceDetails,
	cart,
	discountSlot,
	editableItemId,
	items,
	onEditStay,
	onOpenCurrency,
	onOpenPriceDetails,
	repricingItemIds,
}: CartSummaryProps) {
	const loading = cart === null;
	const repricing = (repricingItemIds?.size ?? 0) > 0;

	return (
		<div className="rounded-2xl border bg-card p-5 shadow-sm">
			<div className="flex items-center justify-between gap-2">
				<span className="font-medium text-sm">
					{loading
						? "Your stays"
						: `${items.length} ${items.length === 1 ? "stay" : "stays"}`}
				</span>
				{canEditCart && (
					<Button
						asChild
						className="h-auto p-0 text-sm underline"
						variant="link"
					>
						<Link href="/cart">Edit cart</Link>
					</Button>
				)}
			</div>

			<Separator className="my-4" />

			{loading ? (
				<div className="flex flex-col gap-3">
					<Skeleton className="h-14 w-full" />
					<Skeleton className="h-14 w-full" />
				</div>
			) : (
				<div className="flex flex-col gap-4">
					{items.map((item) => (
						<SummaryItemRow
							item={item}
							key={item.id}
							onEdit={
								editableItemId === item.id && onEditStay
									? () => onEditStay(item)
									: undefined
							}
							repricing={repricingItemIds?.has(item.id) ?? false}
						/>
					))}
				</div>
			)}

			<Separator className="my-4" />

			<div className="flex items-center justify-between">
				<button
					className="font-medium text-sm underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
					disabled={!canOpenPriceDetails}
					onClick={onOpenPriceDetails}
					type="button"
				>
					Price details
				</button>
				<button
					className="text-muted-foreground text-xs underline underline-offset-2"
					onClick={onOpenCurrency}
					type="button"
				>
					{cart?.currency ?? "EUR"}
				</button>
			</div>

			<div className="mt-3 flex flex-col gap-2 text-sm">
				{cart && !repricing ? (
					<>
						<div className="flex items-center justify-between text-muted-foreground">
							<span>Subtotal</span>
							<span>{formatMinor(cart.subtotalMinor, cart.currency)}</span>
						</div>
						{cart.taxMinor > 0 && (
							<div className="flex items-center justify-between text-muted-foreground">
								<span>Taxes</span>
								<span>{formatMinor(cart.taxMinor, cart.currency)}</span>
							</div>
						)}
						{cart.discountMinor > 0 && (
							<div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
								<span>Discount</span>
								<span>-{formatMinor(cart.discountMinor, cart.currency)}</span>
							</div>
						)}
						<Separator className="my-1" />
						<div className="flex items-center justify-between font-semibold text-base">
							<span>Total</span>
							<span>{formatMinor(cart.totalMinor, cart.currency)}</span>
						</div>
					</>
				) : (
					<div className="flex flex-col gap-2">
						<div className="flex items-center justify-between">
							<Skeleton className="h-4 w-20" />
							<Skeleton className="h-4 w-14" />
						</div>
						<Separator className="my-1" />
						<div className="flex items-center justify-between">
							<Skeleton className="h-5 w-16" />
							<Skeleton className="h-5 w-20" />
						</div>
					</div>
				)}
			</div>

			{discountSlot && <div className="mt-4">{discountSlot}</div>}
		</div>
	);
}
