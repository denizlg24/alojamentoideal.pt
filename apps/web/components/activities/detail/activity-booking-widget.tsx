"use client";

import type {
	ActivityAvailabilityCalendar,
	ActivityDeparture,
	ActivityDetail,
	ActivityParticipantSelection,
	ActivityPricingCategory,
} from "@workspace/core/activities";
import {
	computeDepartureTotal,
	defaultRate,
	occupiedSeats,
	rateUnitPrice,
	totalParticipants,
	validateDepartureSelection,
} from "@workspace/core/activities";
import { Button } from "@workspace/ui/components/button";
import { Calendar } from "@workspace/ui/components/calendar";
import {
	Drawer,
	DrawerContent,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@workspace/ui/components/drawer";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";
import { addDays, format, startOfDay } from "date-fns";
import { CalendarDays, Minus, Plus, Users } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { DayButton as DayButtonProps } from "react-day-picker";
import { AVAILABILITY_WINDOW_DAYS } from "@/lib/activities/constants";
import { formatActivityMoney, formatLanguage } from "@/lib/activities/format";
import { parseIsoDate } from "@/lib/catalog/dates";
import { formatListingMoney } from "@/lib/catalog/pricing-display";

const MAX_PER_CATEGORY = 30;

interface DayEntry {
	date: string;
	departures: ActivityDeparture[];
	/** Max open seats across the day's departures; null when unlimited. */
	seats: number | null;
	soldOut: boolean;
	/** Smallest booking size any departure accepts that day. */
	minToBook: number;
}

type DayState = "none" | "sold_out" | "below_min" | "open";

function departureLabel(departure: ActivityDeparture): string {
	return departure.startTime ?? departure.startTimeLabel ?? "Anytime";
}

function defaultSelection(
	categories: ActivityPricingCategory[],
): ActivityParticipantSelection {
	const primary =
		categories.find((category) => category.isDefault) ?? categories[0];
	return primary ? { [primary.id]: 1 } : {};
}

function categoryHint(category: ActivityPricingCategory): string | null {
	if (category.minAge !== null && category.maxAge !== null) {
		return `Ages ${category.minAge}–${category.maxAge}`;
	}
	if (category.minAge !== null && category.minAge > 0) {
		return `Ages ${category.minAge}+`;
	}
	if (category.maxAge !== null) return `Up to ${category.maxAge}`;
	return null;
}

function buildDays(
	calendar: ActivityAvailabilityCalendar,
): Map<string, DayEntry> {
	const entries = new Map<string, DayEntry>();
	const dates = Object.keys(calendar.departuresByDate).sort();
	for (const date of dates) {
		const departures = calendar.departuresByDate[date] ?? [];
		if (departures.length === 0) continue;
		const seats = departures.some((entry) => entry.availabilityCount === null)
			? null
			: Math.max(0, ...departures.map((entry) => entry.availabilityCount ?? 0));
		entries.set(date, {
			date,
			departures,
			seats,
			soldOut: departures.every((entry) => entry.soldOut),
			minToBook: Math.min(...departures.map((entry) => entry.minParticipants)),
		});
	}
	return entries;
}

/** Cheapest bookable total across a day's departures for the selection. */
function dayPrice(
	entry: DayEntry,
	selection: ActivityParticipantSelection,
): number | null {
	let cheapest: number | null = null;
	for (const departure of entry.departures) {
		if (departure.soldOut) continue;
		const total = computeDepartureTotal(departure, selection);
		if (total !== null && (cheapest === null || total < cheapest)) {
			cheapest = total;
		}
	}
	return cheapest;
}

export function ActivityBookingWidget({
	activity,
	calendar,
	currency,
}: {
	activity: ActivityDetail;
	calendar: ActivityAvailabilityCalendar;
	currency: string;
}) {
	const days = useMemo(() => buildDays(calendar), [calendar]);

	const [selection, setSelection] = useState<ActivityParticipantSelection>(() =>
		defaultSelection(activity.pricingCategories),
	);
	const [selectedDate, setSelectedDate] = useState<string | null>(null);
	const [departureId, setDepartureId] = useState<string | null>(null);
	const [language, setLanguage] = useState<string | null>(
		activity.languages[0] ?? null,
	);
	const [comingSoon, setComingSoon] = useState(false);

	const selectedDay = selectedDate ? (days.get(selectedDate) ?? null) : null;
	const departure =
		selectedDay?.departures.find((entry) => entry.id === departureId) ??
		selectedDay?.departures.find((entry) => !entry.soldOut) ??
		null;

	const participants = totalParticipants(selection);
	const required = occupiedSeats(selection, activity.pricingCategories);
	const issue = departure
		? validateDepartureSelection(
				departure,
				selection,
				activity.pricingCategories,
			)
		: null;
	const total = departure ? computeDepartureTotal(departure, selection) : null;
	const canBook = departure !== null && issue === null && (total ?? 0) > 0;

	const dayState = useCallback(
		(entry: DayEntry | undefined): DayState => {
			if (!entry) return "none";
			if (entry.soldOut) return "sold_out";
			if (entry.seats !== null && entry.seats < Math.max(1, required)) {
				return "sold_out";
			}
			if (entry.minToBook > Math.max(1, participants)) return "below_min";
			return "open";
		},
		[participants, required],
	);

	const canIncrement = (category: ActivityPricingCategory): boolean => {
		if ((selection[category.id] ?? 0) >= MAX_PER_CATEGORY) return false;
		const cap = departure?.availabilityCount ?? selectedDay?.seats ?? null;
		if (cap === null) return true;
		return required + category.occupancy <= cap;
	};

	const setCount = (categoryId: string, next: number) => {
		setComingSoon(false);
		setSelection((current) => ({
			...current,
			[categoryId]: Math.max(0, next),
		}));
	};

	const priceHeader = canBook
		? formatListingMoney(total ?? 0, currency)
		: formatActivityMoney(activity.fromPrice);

	const renderParticipants = () => (
		<section className="flex flex-col gap-2">
			<span className="font-medium text-sm">Participants</span>
			<div className="flex flex-col divide-y rounded-xl border px-3">
				{activity.pricingCategories.map((category) => {
					const count = selection[category.id] ?? 0;
					const hint = categoryHint(category);
					const rate = departure ? defaultRate(departure) : null;
					const unitPrice = rate
						? rateUnitPrice(rate, category.id, Math.max(1, count))
						: null;
					return (
						<div
							key={category.id}
							className="flex items-center justify-between gap-4 py-3"
						>
							<div className="flex flex-col">
								<span className="font-medium text-sm">{category.title}</span>
								{(hint || unitPrice != null) && (
									<span className="text-muted-foreground text-xs">
										{[
											hint,
											unitPrice != null
												? formatListingMoney(unitPrice, currency)
												: null,
										]
											.filter(Boolean)
											.join(" · ")}
									</span>
								)}
							</div>
							<div className="flex items-center gap-3">
								<Button
									type="button"
									variant="outline"
									size="icon"
									className="size-8 rounded-full"
									onClick={() => setCount(category.id, count - 1)}
									disabled={count <= 0}
									aria-label={`Decrease ${category.title}`}
								>
									<Minus className="size-4" />
								</Button>
								<span className="w-5 text-center text-sm tabular-nums">
									{count}
								</span>
								<Button
									type="button"
									variant="outline"
									size="icon"
									className="size-8 rounded-full"
									onClick={() => setCount(category.id, count + 1)}
									disabled={!canIncrement(category)}
									aria-label={`Increase ${category.title}`}
								>
									<Plus className="size-4" />
								</Button>
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);

	// Memoized so react-day-picker keeps the same component type across renders
	// driven by unrelated state (language, coming-soon, start-time). Identity only
	// changes when the day data, selection, or currency actually change, which is
	// when the cells genuinely need to re-render.
	const AvailabilityDayButton = useCallback(
		({
			className,
			day,
			modifiers,
			children: _children,
			...props
		}: React.ComponentProps<typeof DayButtonProps>) => {
			const iso = format(day.date, "yyyy-MM-dd");
			const entry = days.get(iso);
			const state = dayState(entry);
			const price =
				entry && state === "open" ? dayPrice(entry, selection) : null;

			return (
				<button
					{...props}
					className={cn(
						"relative flex aspect-square size-auto w-full min-w-(--cell-size) flex-col items-center justify-center gap-0.5 overflow-hidden rounded-(--cell-radius) rounded-tr-none! leading-none transition-colors",
						state === "open" && "hover:bg-accent",
						state !== "open" && "text-muted-foreground",
						modifiers.selected && "bg-accent ring-1 ring-primary ring-inset",
						className,
					)}
				>
					<span className="text-xs sm:text-sm">{day.date.getDate()}</span>
					{state === "open" && price !== null && (
						<span className="font-medium text-[0.6rem] text-emerald-600 dark:text-emerald-400">
							{formatListingMoney(price, currency)}
						</span>
					)}
					{state === "below_min" && entry && (
						<span className="flex items-center gap-0.5 text-[0.5rem] text-foreground">
							Min {entry.minToBook}
							<Users className="size-2 shrink-0" />
						</span>
					)}
					{state === "open" && (
						<span className="absolute -top-2 -right-2 size-4 rotate-45 bg-emerald-400/80" />
					)}
					{state === "below_min" && (
						<span className="absolute -top-2 -right-2 size-4 rotate-45 bg-amber-400/80" />
					)}
					{state === "sold_out" && (
						<span className="absolute -top-2 -right-2 size-4 rotate-45 bg-destructive/70" />
					)}
				</button>
			);
		},
		[currency, dayState, days, selection],
	);

	const calendarComponents = useMemo(
		() => ({ DayButton: AvailabilityDayButton }),
		[AvailabilityDayButton],
	);

	const renderCalendar = () => {
		if (days.size === 0) {
			return (
				<p className="rounded-lg border border-dashed px-3 py-6 text-center text-muted-foreground text-sm">
					No upcoming availability. Please check back soon or contact us.
				</p>
			);
		}
		const today = startOfDay(new Date());
		return (
			<section className="flex flex-col gap-2">
				<span className="font-medium text-sm">Choose a date</span>
				<Calendar
					mode="single"
					className="w-full p-0 [--cell-size:--spacing(10)]"
					classNames={{ root: "w-full", month: "flex w-full flex-col gap-3" }}
					weekStartsOn={1}
					showOutsideDays={false}
					startMonth={today}
					endMonth={addDays(today, AVAILABILITY_WINDOW_DAYS)}
					selected={selectedDate ? parseIsoDate(selectedDate) : undefined}
					onSelect={(date) => {
						setComingSoon(false);
						setDepartureId(null);
						setSelectedDate(date ? format(date, "yyyy-MM-dd") : null);
					}}
					disabled={(date) =>
						dayState(days.get(format(date, "yyyy-MM-dd"))) !== "open"
					}
					components={calendarComponents}
				/>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
					<span className="flex items-center gap-1.5">
						<span className="size-2 rounded-full bg-emerald-400" />
						Available
					</span>
					<span className="flex items-center gap-1.5">
						<span className="size-2 rounded-full bg-amber-400" />
						Needs more participants
					</span>
					<span className="flex items-center gap-1.5">
						<span className="size-2 rounded-full bg-destructive/80" />
						Sold out
					</span>
				</div>
			</section>
		);
	};

	const renderStartTimes = () => {
		if (!selectedDay || selectedDay.departures.length <= 1) return null;
		return (
			<section className="flex flex-col gap-2">
				<span className="font-medium text-sm">
					Start time · {format(parseIsoDate(selectedDay.date), "EEE, MMM d")}
				</span>
				<div className="flex flex-wrap gap-2">
					{selectedDay.departures.map((entry) => (
						<button
							key={entry.id}
							type="button"
							aria-pressed={entry.id === departure?.id}
							onClick={() => {
								setComingSoon(false);
								setDepartureId(entry.id);
							}}
							disabled={entry.soldOut}
							className={cn(
								"rounded-full border px-3 py-1.5 font-medium text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
								entry.id === departure?.id
									? "border-primary bg-primary text-primary-foreground"
									: "border-border bg-card hover:border-primary/40 hover:bg-accent",
							)}
						>
							{departureLabel(entry)}
						</button>
					))}
				</div>
			</section>
		);
	};

	const renderLanguage = () => {
		if (activity.languages.length <= 1) return null;
		return (
			<section className="flex flex-col gap-2">
				<span className="font-medium text-sm">Language</span>
				<Select
					value={language ?? undefined}
					onValueChange={(value) => setLanguage(value)}
				>
					<SelectTrigger className="w-full">
						<SelectValue placeholder="Select a language" />
					</SelectTrigger>
					<SelectContent>
						{activity.languages.map((code) => (
							<SelectItem key={code} value={code}>
								{formatLanguage(code)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</section>
		);
	};

	const renderBookAction = () => (
		<div className="flex flex-col gap-2">
			<Button
				size="lg"
				className="w-full"
				disabled={!canBook}
				type="button"
				onClick={() => setComingSoon(true)}
			>
				<CalendarDays className="size-4" />
				{canBook
					? `Book · ${formatListingMoney(total ?? 0, currency)}`
					: selectedDate
						? "Book"
						: "Choose a date"}
			</Button>
			<p className="text-center text-muted-foreground text-xs">
				{comingSoon
					? "Online booking for activities is coming soon. Contact us to reserve."
					: "You won't be charged yet"}
			</p>
		</div>
	);

	const content = (
		<div className="flex flex-col gap-5">
			{renderParticipants()}
			{renderCalendar()}
			{renderStartTimes()}
			{renderLanguage()}
			<BookingMessage issue={issue} />
			{canBook && departure && (
				<PriceBreakdown
					categories={activity.pricingCategories}
					currency={currency}
					departure={departure}
					selection={selection}
					total={total ?? 0}
				/>
			)}
			{renderBookAction()}
		</div>
	);

	return (
		<>
			<div className="hidden lg:block">
				<div className="sticky top-24 flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-lg">
					<PriceHeader price={priceHeader} showFrom={!canBook} />
					{content}
				</div>
			</div>

			<div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:hidden">
				<Drawer>
					<div className="flex items-center justify-between gap-4">
						<div className="flex flex-col">
							<span className="font-semibold text-base">
								{priceHeader ?? "See prices"}
							</span>
							<span className="text-muted-foreground text-xs">
								{canBook ? "total" : "per person"}
							</span>
						</div>
						<DrawerTrigger asChild>
							<Button size="lg">
								<CalendarDays className="size-4" />
								{canBook ? "Review" : "Choose date"}
							</Button>
						</DrawerTrigger>
					</div>
					<DrawerContent>
						<DrawerHeader className="text-left">
							<DrawerTitle>{activity.title}</DrawerTitle>
						</DrawerHeader>
						<div className="max-h-[78vh] overflow-y-auto px-4 pb-8">
							{content}
						</div>
					</DrawerContent>
				</Drawer>
			</div>
		</>
	);
}

function PriceHeader({
	price,
	showFrom,
}: {
	price: string | null;
	showFrom: boolean;
}) {
	if (!price) {
		return (
			<span className="font-medium text-base text-muted-foreground">
				Select participants for prices
			</span>
		);
	}
	return (
		<div className="flex items-baseline gap-1.5">
			{showFrom && <span className="text-muted-foreground text-sm">from</span>}
			<span className="font-semibold text-xl">{price}</span>
			<span className="text-muted-foreground text-sm">
				{showFrom ? "/ person" : "total"}
			</span>
		</div>
	);
}

function BookingMessage({
	issue,
}: {
	issue: ReturnType<typeof validateDepartureSelection>;
}) {
	if (!issue) return null;
	const message = (() => {
		switch (issue.reason) {
			case "sold_out":
				return "This date is sold out. Please choose another day.";
			case "below_min":
				return `This departure needs at least ${issue.minParticipants} participants.`;
			case "over_capacity":
				return `Only ${issue.availableSeats} seats left for this date.`;
			case "unpriced":
				return "Those participants aren't available on this date.";
			default:
				return null;
		}
	})();
	if (!message) return null;
	return (
		<p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 text-sm dark:bg-amber-950 dark:text-amber-200">
			{message}
		</p>
	);
}

function PriceBreakdown({
	categories,
	currency,
	departure,
	selection,
	total,
}: {
	categories: ActivityPricingCategory[];
	currency: string;
	departure: ActivityDeparture;
	selection: ActivityParticipantSelection;
	total: number;
}) {
	const rate = defaultRate(departure);
	const lines = categories
		.map((category) => {
			const count = selection[category.id] ?? 0;
			const unit = rate ? rateUnitPrice(rate, category.id, count) : null;
			if (count <= 0 || unit == null) return null;
			return {
				id: category.id,
				title: category.title,
				count,
				subtotal: unit * count,
				unit,
			};
		})
		.filter((line): line is NonNullable<typeof line> => line !== null);

	return (
		<div className="flex flex-col gap-2 text-sm">
			{lines.map((line) => (
				<div key={line.id} className="flex items-center justify-between">
					<span className="text-muted-foreground">
						{line.title} · {formatListingMoney(line.unit, currency)} ×{" "}
						{line.count}
					</span>
					<span>{formatListingMoney(line.subtotal, currency)}</span>
				</div>
			))}
			<Separator />
			<div className="flex items-center justify-between font-semibold">
				<span>Total</span>
				<span>{formatListingMoney(total, currency)}</span>
			</div>
		</div>
	);
}
