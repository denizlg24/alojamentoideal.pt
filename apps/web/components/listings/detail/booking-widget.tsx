"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Drawer,
	DrawerContent,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@workspace/ui/components/drawer";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import { format } from "date-fns";
import { ChevronDown, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { DateRange } from "react-day-picker";
import { nightsBetween, parseIsoDate, toIsoDate } from "@/lib/catalog/dates";
import { capacityForGuests } from "@/lib/catalog/guests";
import { formatListingMoney } from "@/lib/catalog/pricing-display";
import { GuestFields } from "../../search/guest-selector";
import { ListingCalendar } from "./listing-calendar";
import { useBookingAvailability } from "./use-booking-availability";
import { type QuoteState, useListingQuote } from "./use-listing-quote";

interface GuestCounts {
	adults: number;
	children: number;
}

interface BookingWidgetProps {
	currency: string;
	listingId: string;
	maxGuests: number | null;
	minNights: number;
}

function intParam(value: string | null, fallback: number, min: number): number {
	const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
	return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function guestSummary({ adults, children }: GuestCounts): string {
	const parts = [`${adults} ${adults === 1 ? "adult" : "adults"}`];
	if (children > 0) {
		parts.push(`${children} ${children === 1 ? "child" : "children"}`);
	}
	return parts.join(", ");
}

export function BookingWidget({
	currency,
	listingId,
	maxGuests,
	minNights,
}: BookingWidgetProps) {
	const searchParams = useSearchParams();
	const [range, setRange] = useState<DateRange | undefined>(() => {
		const checkIn = searchParams.get("checkIn");
		const checkOut = searchParams.get("checkOut");
		return checkIn && checkOut
			? { from: parseIsoDate(checkIn), to: parseIsoDate(checkOut) }
			: undefined;
	});
	const [guests, setGuests] = useState<GuestCounts>(() => ({
		adults: intParam(searchParams.get("adults"), 1, 1),
		children: intParam(searchParams.get("children"), 0, 0),
	}));
	const [added, setAdded] = useState(false);
	const [datesOpen, setDatesOpen] = useState(false);

	const availabilityState = useBookingAvailability(listingId, minNights);
	const availability =
		availabilityState.status === "ready"
			? availabilityState.availability
			: null;
	const availableDates = availability?.availableDates ?? null;

	// Once the calendar loads, preselect the soonest valid stay unless the visitor
	// already arrived with dates in the URL or has picked some.
	const presetDone = useRef(false);
	useEffect(() => {
		if (presetDone.current || range || !availability?.earliestStay) {
			return;
		}
		presetDone.current = true;
		setRange({
			from: parseIsoDate(availability.earliestStay.checkIn),
			to: parseIsoDate(availability.earliestStay.checkOut),
		});
	}, [availability, range]);

	const checkIn = range?.from ? toIsoDate(range.from) : null;
	const checkOut = range?.to ? toIsoDate(range.to) : null;
	const guestCapacity = capacityForGuests(guests.adults, guests.children);
	const guestLimitError = maxGuests !== null && guestCapacity > maxGuests;

	const quote = useListingQuote({
		adults: guests.adults,
		checkIn,
		checkOut,
		children: guests.children,
		enabled: !guestLimitError,
		guests: guestCapacity,
		listingId,
	});

	const minStay = checkIn
		? (availability?.minStayByDate[checkIn] ?? minNights)
		: minNights;
	const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
	const minStayError = Boolean(checkIn && checkOut && nights < minStay);

	const reserveHref =
		checkIn && checkOut
			? `/homes/${listingId}/book?${new URLSearchParams({
					adults: String(guests.adults),
					checkIn,
					checkOut,
					children: String(guests.children),
					guests: String(guestCapacity),
				}).toString()}`
			: null;
	const canReserve =
		quote.status === "ready" &&
		!guestLimitError &&
		!minStayError &&
		reserveHref !== null;

	const handleAddToCart = () => {
		setAdded(true);
		setTimeout(() => setAdded(false), 2000);
	};

	// Auto-close the desktop date popover once a full range is chosen so the
	// visitor gets immediate confirmation; partial selections keep it open.
	const handleRangeSelect = (next: DateRange | undefined) => {
		setRange(next);
		if (next?.from && next?.to) {
			setDatesOpen(false);
		}
	};

	const popoverInputs = (numberOfMonths: number) => (
		<div className="overflow-hidden rounded-xl border">
			<Popover open={datesOpen} onOpenChange={setDatesOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						className="grid w-full grid-cols-2 divide-x text-left transition-colors data-[state=open]:bg-accent/40"
					>
						<DateCell label="Check-in" date={range?.from} />
						<DateCell label="Checkout" date={range?.to} />
					</button>
				</PopoverTrigger>
				<PopoverContent align="end" className="w-auto p-2">
					<ListingCalendar
						availableDates={availableDates}
						numberOfMonths={numberOfMonths}
						onChange={handleRangeSelect}
						value={range}
					/>
				</PopoverContent>
			</Popover>
			<Separator />
			<Popover>
				<PopoverTrigger asChild>
					<button
						type="button"
						className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors data-[state=open]:bg-accent/40"
					>
						<span className="flex flex-col">
							<span className="font-medium text-muted-foreground text-xs uppercase">
								Guests
							</span>
							<span className="text-sm">{guestSummary(guests)}</span>
						</span>
						<ChevronDown className="size-4 text-muted-foreground" />
					</button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-80 p-4">
					<GuestFields onChange={setGuests} value={guests} />
					{maxGuests !== null && (
						<p className="mt-2 text-muted-foreground text-xs">
							This home sleeps up to {maxGuests}.
						</p>
					)}
				</PopoverContent>
			</Popover>
		</div>
	);

	// On mobile the calendar/guest selectors live inside a Drawer; nested popovers
	// there fight the on-screen keyboard, so the inputs render inline instead,
	// mirroring the /homes stay-search sheet.
	const inlineInputs = (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-2">
				<p className="font-medium text-sm">Dates</p>
				<div className="flex justify-center rounded-xl border p-2">
					<ListingCalendar
						availableDates={availableDates}
						numberOfMonths={1}
						onChange={setRange}
						value={range}
					/>
				</div>
			</div>
			<div className="flex flex-col gap-2">
				<p className="font-medium text-sm">Guests</p>
				<div className="rounded-xl border px-3">
					<GuestFields onChange={setGuests} value={guests} />
					{maxGuests !== null && (
						<p className="pb-3 text-muted-foreground text-xs">
							This home sleeps up to {maxGuests}.
						</p>
					)}
				</div>
			</div>
		</div>
	);

	const body = (numberOfMonths: number, layout: "inline" | "popover") => (
		<div className="flex flex-col gap-4">
			<PriceHeader currency={currency} quote={quote} />

			{layout === "inline" ? inlineInputs : popoverInputs(numberOfMonths)}

			<BookingMessage
				guestLimitError={guestLimitError}
				maxGuests={maxGuests}
				minStay={minStay}
				minStayError={minStayError}
				quote={quote}
			/>

			<div className="flex flex-col gap-2">
				{reserveHref && canReserve ? (
					<Button asChild size="lg" className="w-full">
						<Link href={reserveHref}>Reserve</Link>
					</Button>
				) : (
					<Button
						size="lg"
						className="w-full"
						disabled
						aria-disabled="true"
						type="button"
					>
						Reserve
					</Button>
				)}
				<Button
					variant="outline"
					size="lg"
					className="w-full"
					onClick={handleAddToCart}
					disabled={!canReserve}
					type="button"
				>
					<ShoppingCart className="size-4" />
					{added ? "Added to cart" : "Add to cart"}
				</Button>
			</div>
			<p className="text-center text-muted-foreground text-xs">
				You won't be charged yet
			</p>

			{quote.status === "ready" && !minStayError && (
				<PriceBreakdown
					currency={currency}
					nights={nights}
					quote={quote.quote}
				/>
			)}
		</div>
	);

	return (
		<>
			<div className="hidden lg:block">
				<div className="sticky top-24 rounded-2xl border bg-card p-6 shadow-lg">
					{body(2, "popover")}
				</div>
			</div>

			<div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background px-4 py-3 lg:hidden">
				<Drawer>
					<div className="flex items-center justify-between gap-4">
						<MobilePriceSummary currency={currency} quote={quote} />
						<DrawerTrigger asChild>
							<Button size="lg">Reserve</Button>
						</DrawerTrigger>
					</div>
					<DrawerContent>
						<DrawerHeader className="text-left">
							<DrawerTitle>Choose your stay</DrawerTitle>
						</DrawerHeader>
						<div className="max-h-[70vh] overflow-y-auto px-4 pb-8">
							{body(1, "inline")}
						</div>
					</DrawerContent>
				</Drawer>
			</div>
		</>
	);
}

function DateCell({ date, label }: { date: Date | undefined; label: string }) {
	return (
		<span className="flex flex-col px-3 py-2">
			<span className="font-medium text-muted-foreground text-xs uppercase">
				{label}
			</span>
			<span className={cn("text-sm", !date && "text-muted-foreground")}>
				{date ? format(date, "MMM d, yyyy") : "Add date"}
			</span>
		</span>
	);
}

function PriceHeader({
	currency,
	quote,
}: {
	currency: string;
	quote: QuoteState;
}) {
	if (quote.status === "ready") {
		return (
			<div className="flex items-baseline gap-1.5">
				<span className="font-semibold text-xl">
					{formatListingMoney(quote.quote.total, currency)}
				</span>
				<span className="text-muted-foreground">total</span>
				{quote.quote.nightlyAverage !== null && (
					<span className="ml-auto text-muted-foreground text-sm">
						{formatListingMoney(quote.quote.nightlyAverage, currency)} / night
					</span>
				)}
			</div>
		);
	}
	if (quote.status === "loading") {
		return <Skeleton className="h-7 w-32" />;
	}
	return (
		<span className="font-medium text-base text-muted-foreground">
			Add dates for prices
		</span>
	);
}

function MobilePriceSummary({
	currency,
	quote,
}: {
	currency: string;
	quote: QuoteState;
}) {
	if (quote.status === "ready") {
		return (
			<div className="flex flex-col">
				<span className="font-semibold text-base">
					{formatListingMoney(quote.quote.total, currency)}
				</span>
				<span className="text-muted-foreground text-xs">total</span>
			</div>
		);
	}
	if (quote.status === "loading") {
		return <Skeleton className="h-9 w-24" />;
	}
	return <span className="font-medium text-sm">Add dates for prices</span>;
}

function BookingMessage({
	guestLimitError,
	maxGuests,
	minStay,
	minStayError,
	quote,
}: {
	guestLimitError: boolean;
	maxGuests: number | null;
	minStay: number;
	minStayError: boolean;
	quote: QuoteState;
}) {
	if (guestLimitError) {
		return (
			<p className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-sm">
				This home cannot accommodate that many guests
				{maxGuests === null ? "." : `; it sleeps up to ${maxGuests}.`}
			</p>
		);
	}
	if (minStayError) {
		return (
			<p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 text-sm dark:bg-amber-950 dark:text-amber-200">
				This home has a {minStay}-night minimum stay.
			</p>
		);
	}
	if (quote.status === "unavailable") {
		return (
			<p className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-sm">
				These dates are no longer available. Please choose a different period.
			</p>
		);
	}
	if (quote.status === "error") {
		return (
			<p className="rounded-lg bg-muted px-3 py-2 text-muted-foreground text-sm">
				{quote.message}
			</p>
		);
	}
	return null;
}

function PriceBreakdown({
	currency,
	nights,
	quote,
}: {
	currency: string;
	nights: number;
	quote: Extract<QuoteState, { status: "ready" }>["quote"];
}) {
	const nightly = quote.nightlyAverage;
	const extraLines = quote.fees.filter(
		(fee) => !fee.isBasePrice && fee.total !== 0,
	);

	return (
		<div className="flex flex-col gap-2 text-sm">
			{nightly !== null && (
				<div className="flex items-center justify-between">
					<span className="text-muted-foreground underline">
						{formatListingMoney(nightly, currency)} x {nights}{" "}
						{nights === 1 ? "night" : "nights"}
					</span>
					<span>{formatListingMoney(nightly * nights, currency)}</span>
				</div>
			)}
			{extraLines.map((fee, index) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: fee names can repeat
					key={`${fee.name}-${index}`}
					className="flex items-center justify-between"
				>
					<span className="text-muted-foreground">
						{fee.name}
						{fee.chargeLabel && (
							<span className="text-muted-foreground/70">
								{" "}
								· {fee.chargeLabel}
							</span>
						)}
					</span>
					<span>{formatListingMoney(fee.total, currency)}</span>
				</div>
			))}
			<Separator />
			<div className="flex items-center justify-between font-semibold">
				<span>Total</span>
				<span>{formatListingMoney(quote.total, currency)}</span>
			</div>
			{quote.vatIncluded > 0 && (
				<p className="text-muted-foreground text-xs">
					Includes {formatListingMoney(quote.vatIncluded, currency)} VAT
				</p>
			)}
		</div>
	);
}
