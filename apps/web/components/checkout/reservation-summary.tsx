"use client";

import type { CartDto, CartItemDto } from "@workspace/core/commerce";
import { Button } from "@workspace/ui/components/button";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Star } from "lucide-react";
import type { ReactNode } from "react";
import {
	formatMinor,
	formatStayRangeLong,
	guestSummaryLabel,
	nightsLabel,
} from "@/lib/checkout/format";
import type { InitialListing } from "./types";

interface ReservationSummaryProps {
	cart: CartDto | null;
	discountSlot?: ReactNode;
	item: CartItemDto | null;
	listing: InitialListing;
	onChangeDates: () => void;
	onChangeGuests: () => void;
	onOpenCurrency: () => void;
	onOpenPriceDetails: () => void;
}

function SummaryRow({
	label,
	onChange,
	value,
}: {
	label: string;
	onChange: () => void;
	value: string;
}) {
	return (
		<div className="flex items-start justify-between gap-3">
			<div className="flex flex-col">
				<span className="font-medium text-sm">{label}</span>
				<span className="text-muted-foreground text-sm">{value}</span>
			</div>
			<Button
				className="h-auto p-0 text-sm underline"
				onClick={onChange}
				variant="link"
			>
				Change
			</Button>
		</div>
	);
}

/** Sticky reservation summary: listing, stay, guests, price lines, discount. */
export function ReservationSummary({
	cart,
	discountSlot,
	item,
	listing,
	onChangeDates,
	onChangeGuests,
	onOpenCurrency,
	onOpenPriceDetails,
}: ReservationSummaryProps) {
	return (
		<div className="rounded-2xl border bg-card p-5 shadow-sm">
			<div className="flex gap-3">
				<div
					className="size-20 shrink-0 rounded-xl bg-center bg-cover bg-muted"
					style={
						listing.coverPhotoUrl
							? { backgroundImage: `url(${listing.coverPhotoUrl})` }
							: undefined
					}
				/>
				<div className="flex min-w-0 flex-col justify-center gap-1">
					<span className="line-clamp-2 font-medium text-sm">
						{listing.title}
					</span>
					{listing.reviewAverage !== null && (
						<span className="flex items-center gap-1 text-muted-foreground text-xs">
							<Star className="size-3.5 fill-foreground text-foreground" />
							{listing.reviewAverage.toFixed(2)}
							<span>
								· {listing.reviewCount}{" "}
								{listing.reviewCount === 1 ? "review" : "reviews"}
							</span>
						</span>
					)}
				</div>
			</div>

			<Separator className="my-4" />

			{item ? (
				<div className="flex flex-col gap-3">
					<SummaryRow
						label="Dates"
						onChange={onChangeDates}
						value={`${formatStayRangeLong(item.checkIn, item.checkOut)} · ${nightsLabel(item.nights)}`}
					/>
					<SummaryRow
						label="Guests"
						onChange={onChangeGuests}
						value={guestSummaryLabel({
							adults: item.adults,
							children: item.children,
							infants: item.infants,
						})}
					/>
				</div>
			) : (
				<div className="flex flex-col gap-3">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			)}

			<Separator className="my-4" />

			<div className="flex items-center justify-between">
				<button
					className="font-medium text-sm underline underline-offset-2"
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
					{cart?.currency ?? listing.currency}
				</button>
			</div>

			<div className="mt-3 flex flex-col gap-2 text-sm">
				{cart && item ? (
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
					<Skeleton className="h-6 w-full" />
				)}
			</div>

			{discountSlot && <div className="mt-4">{discountSlot}</div>}
		</div>
	);
}
