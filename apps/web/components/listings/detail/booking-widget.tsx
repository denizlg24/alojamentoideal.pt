"use client";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@workspace/ui/components/accordion";
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
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { DateRange } from "react-day-picker";
import { nightsBetween, parseIsoDate, toIsoDate } from "@/lib/catalog/dates";
import { capacityForGuests, MAX_INFANTS } from "@/lib/catalog/guests";
import { formatListingMoney } from "@/lib/catalog/pricing-display";
import { addStayToCart } from "@/lib/checkout/cart-store";
import { GuestFields } from "../../search/guest-selector";
import { ListingCalendar } from "./listing-calendar";
import { useBookingAvailability } from "./use-booking-availability";
import { type QuoteState, useListingQuote } from "./use-listing-quote";

interface GuestCounts {
	adults: number;
	children: number;
	infants: number;
}

interface BookingWidgetProps {
	currency: string;
	listingId: string;
	maxGuests: number | null;
	minNights: number;
}

function intParam(
	value: string | null,
	fallback: number,
	min: number,
	max?: number,
): number {
	const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
	if (!Number.isFinite(parsed) || parsed < min) {
		return fallback;
	}
	return max !== undefined ? Math.min(parsed, max) : parsed;
}

// Compact stay range for the mobile summary, e.g. "Jun 23-26" within one month
// or "Jun 30 - Jul 2" across months.
function formatStayRange(checkIn: string, checkOut: string): string {
	const from = parseIsoDate(checkIn);
	const to = parseIsoDate(checkOut);
	if (
		from.getMonth() === to.getMonth() &&
		from.getFullYear() === to.getFullYear()
	) {
		return `${format(from, "MMM d")}-${format(to, "d")}`;
	}
	return `${format(from, "MMM d")} - ${format(to, "MMM d")}`;
}

function guestSummary({ adults, children, infants }: GuestCounts): string {
	const parts = [`${adults} ${adults === 1 ? "adult" : "adults"}`];
	if (children > 0) {
		parts.push(`${children} ${children === 1 ? "child" : "children"}`);
	}
	if (infants > 0) {
		parts.push(`${infants} ${infants === 1 ? "infant" : "infants"}`);
	}
	return parts.join(", ");
}

export function BookingWidget(props: BookingWidgetProps) {
	const searchParams = useSearchParams();
	const seedKey = [
		searchParams.get("checkIn"),
		searchParams.get("checkOut"),
		searchParams.get("adults"),
		searchParams.get("children"),
		searchParams.get("infants"),
	].join("|");
	return <BookingWidgetInner key={seedKey} {...props} />;
}

function BookingWidgetInner({
	currency,
	listingId,
	maxGuests,
	minNights,
}: BookingWidgetProps) {
	const searchParams = useSearchParams();
	const router = useRouter();
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
		infants: intParam(searchParams.get("infants"), 0, 0, MAX_INFANTS),
	}));
	const [added, setAdded] = useState(false);
	const [adding, setAdding] = useState(false);
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
		infants: guests.infants,
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
					infants: String(guests.infants),
				}).toString()}`
			: null;
	const canReserve =
		quote.status === "ready" &&
		!guestLimitError &&
		!minStayError &&
		reserveHref !== null;

	// Warm the checkout route once the stay is stable and bookable so navigation
	// overlaps the click. The Reserve <Link> only auto-prefetches in the viewport,
	// which on mobile is hidden inside the reserve drawer until it is opened.
	useEffect(() => {
		if (canReserve && reserveHref) {
			router.prefetch(reserveHref);
		}
	}, [canReserve, reserveHref, router]);

	const handleAddToCart = async () => {
		if (!checkIn || !checkOut || adding) {
			return;
		}
		setAdding(true);
		try {
			// The shared cart store dedupes an identical stay server-side and
			// broadcasts the new count to the header badge.
			await addStayToCart({
				adults: guests.adults,
				checkIn,
				checkOut,
				children: guests.children,
				guests: guestCapacity,
				infants: guests.infants,
				listingId,
			});
			setAdded(true);
			setTimeout(() => setAdded(false), 2000);
		} catch {
			// Quietly ignore here: the visitor can still use Reserve, which routes
			// to the full checkout where errors are surfaced clearly.
		} finally {
			setAdding(false);
		}
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

	// The calendar and guest selectors are shared by the always-on mobile section,
	// the mobile drawer's collapsed sections, and (for guests) the desktop popover.
	const renderDates = () => (
		<div className="flex justify-center rounded-xl border p-2">
			<ListingCalendar
				availableDates={availableDates}
				numberOfMonths={1}
				onChange={setRange}
				value={range}
			/>
		</div>
	);

	const renderGuests = () => (
		<div className="rounded-xl border px-3">
			<GuestFields onChange={setGuests} value={guests} />
			{maxGuests !== null && (
				<p className="pb-3 text-muted-foreground text-xs">
					This home sleeps up to {maxGuests}.
				</p>
			)}
		</div>
	);

	const renderBookingMessage = () => (
		<BookingMessage
			guestLimitError={guestLimitError}
			maxGuests={maxGuests}
			minStay={minStay}
			minStayError={minStayError}
			quote={quote}
		/>
	);

	const renderReserveActions = () => (
		<>
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
					disabled={!canReserve || adding}
					type="button"
				>
					<ShoppingCart className="size-4" />
					{added ? "Added to cart" : adding ? "Adding" : "Add to cart"}
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
		</>
	);

	const dateSummary =
		checkIn && checkOut ? formatStayRange(checkIn, checkOut) : "Add dates";

	return (
		<>
			<div className="hidden lg:block">
				<div className="sticky top-24 rounded-2xl border bg-card p-6 shadow-lg">
					<div className="flex flex-col gap-4">
						<PriceHeader currency={currency} quote={quote} />
						{popoverInputs(2)}
						{renderBookingMessage()}
						{renderReserveActions()}
					</div>
				</div>
			</div>

			{/* Always-on stay editor on mobile, so the visitor can adjust dates and
			    guests inline without opening the reserve drawer. */}
			<section className="flex flex-col gap-5 lg:hidden">
				<h2 className="font-heading font-semibold text-xl">Choose your stay</h2>
				<div className="flex flex-col gap-2">
					<p className="font-medium text-sm">Dates</p>
					{renderDates()}
				</div>
				<div className="flex flex-col gap-2">
					<p className="font-medium text-sm">Guests</p>
					{renderGuests()}
				</div>
				{renderBookingMessage()}
			</section>

			<div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] lg:hidden">
				<Drawer>
					<div className="flex items-center justify-between gap-4">
						<MobilePriceSummary currency={currency} quote={quote} />
						<DrawerTrigger asChild>
							<Button size="lg">Reserve</Button>
						</DrawerTrigger>
					</div>
					<DrawerContent>
						<DrawerHeader className="text-left">
							<DrawerTitle>Review your stay</DrawerTitle>
						</DrawerHeader>
						<div className="max-h-[70vh] overflow-y-auto px-4 pb-8">
							<div className="flex flex-col gap-4">
								<PriceHeader currency={currency} quote={quote} />
								<Accordion type="single" collapsible className="w-full">
									<AccordionItem value="dates">
										<AccordionTrigger>
											<span className="flex flex-col gap-0.5 text-left">
												<span className="font-medium text-base">Dates</span>
												<span className="font-normal text-muted-foreground text-xs">
													{dateSummary}
												</span>
											</span>
										</AccordionTrigger>
										<AccordionContent>{renderDates()}</AccordionContent>
									</AccordionItem>
									<AccordionItem value="guests">
										<AccordionTrigger>
											<span className="flex flex-col gap-0.5 text-left">
												<span className="font-medium text-base">Guests</span>
												<span className="font-normal text-muted-foreground text-xs">
													{guestSummary(guests)}
												</span>
											</span>
										</AccordionTrigger>
										<AccordionContent>{renderGuests()}</AccordionContent>
									</AccordionItem>
								</Accordion>
								{renderBookingMessage()}
								{renderReserveActions()}
							</div>
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
				<span className="text-muted-foreground text-xs">
					total · {formatStayRange(quote.quote.checkIn, quote.quote.checkOut)}
				</span>
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
