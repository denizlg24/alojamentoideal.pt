"use client";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@workspace/ui/components/accordion";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { ResponsiveSelect } from "@workspace/ui/components/responsive-select";
import { Separator } from "@workspace/ui/components/separator";
import { Slider } from "@workspace/ui/components/slider";
import { cn } from "@workspace/ui/lib/utils";
import { format, parseISO } from "date-fns";
import {
	ArrowDownAZ,
	ArrowDownWideNarrow,
	ArrowLeft,
	ArrowUpNarrowWide,
	MapPin,
	Maximize2,
	SlidersHorizontal,
	Sparkles,
	X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { AmenityIcon } from "@/components/listings/amenity-icon";
import type { HomesAmenityFacet } from "@/lib/catalog/amenities";
import {
	buildHomesHref,
	countAdvancedFilters,
	DEFAULT_HOMES_FILTERS,
	type HomesFilters,
	parseHomesFilters,
} from "@/lib/catalog/homes-filters";
import {
	CATALOG_LOCATION_PRESETS,
	findLocationPreset,
} from "@/lib/catalog/locations";
import { formatListingMoney } from "@/lib/catalog/pricing-display";
import { DateRangeField, StayCalendar } from "../search/date-range";
import {
	type GuestCounts,
	GuestFields,
	GuestSelector,
} from "../search/guest-selector";
import { FilterPill } from "./filter-pill";
import { useHomesPending } from "./homes-pending";

const RATING_OPTIONS = [
	{ label: "Any", value: null },
	{ label: "3+", value: 3 },
	{ label: "4+", value: 4 },
	{ label: "4.5+", value: 4.5 },
] as const;

const ROOM_OPTIONS = [
	{ label: "Any", value: null },
	{ label: "1", value: 1 },
	{ label: "2", value: 2 },
	{ label: "3", value: 3 },
	{ label: "4", value: 4 },
	{ label: "5", value: 5 },
	{ label: "6", value: 6 },
	{ label: "7", value: 7 },
	{ label: "8+", value: 8 },
] as const;

const AMENITY_PREVIEW_COUNT = 8;

function toDateRange(filters: HomesFilters): DateRange | undefined {
	if (!filters.checkIn) return undefined;
	return {
		from: parseISO(filters.checkIn),
		to: filters.checkOut ? parseISO(filters.checkOut) : undefined,
	};
}

function PillRow({
	onChange,
	options,
	value,
}: {
	onChange: (value: number | null) => void;
	options: ReadonlyArray<{ label: string; value: number | null }>;
	value: number | null;
}) {
	return (
		<div className="flex flex-wrap gap-2">
			{options.map((option) => (
				<FilterPill
					key={option.label}
					active={option.value === value}
					onClick={() => onChange(option.value)}
				>
					{option.label}
				</FilterPill>
			))}
		</div>
	);
}

function FilterSection({
	children,
	title,
}: {
	children: ReactNode;
	title: string;
}) {
	return (
		<section className="flex flex-col gap-4 py-6">
			<h3 className="font-heading font-medium text-foreground text-lg">
				{title}
			</h3>
			{children}
		</section>
	);
}

export function HomesFilterBar({
	amenityFacets,
	currency,
	priceBounds,
	total,
}: {
	amenityFacets: HomesAmenityFacet[];
	currency: string;
	priceBounds: { max: number; min: number } | null;
	total: number;
}) {
	const searchParams = useSearchParams();
	const { isPending, navigate } = useHomesPending();
	const filters = useMemo(
		() => parseHomesFilters(new URLSearchParams(searchParams.toString())),
		[searchParams],
	);
	const [optimisticFilters, setOptimisticFilters] =
		useState<HomesFilters | null>(null);
	const visibleFilters = optimisticFilters ?? filters;

	useEffect(() => {
		if (optimisticFilters && !isPending) {
			setOptimisticFilters(null);
		}
	}, [isPending, optimisticFilters]);

	const committedDateRange = useMemo(
		() => toDateRange(visibleFilters),
		[visibleFilters],
	);

	const [dateOpen, setDateOpen] = useState(false);
	const [dateDraft, setDateDraft] = useState<DateRange | undefined>(
		committedDateRange,
	);
	const [guestOpen, setGuestOpen] = useState(false);
	const [guestDraft, setGuestDraft] = useState<GuestCounts | null>(null);
	const [searchOpen, setSearchOpen] = useState(false);
	const [sheetOpen, setSheetOpen] = useState(false);
	const [showAllAmenities, setShowAllAmenities] = useState(false);
	const [draft, setDraft] = useState<HomesFilters>(filters);

	const apply = (next: HomesFilters) => {
		const href = buildHomesHref(next);
		const currentHref = searchParams.toString()
			? `/homes?${searchParams.toString()}`
			: "/homes";

		setDateOpen(false);
		setGuestOpen(false);
		setSearchOpen(false);
		setSheetOpen(false);

		if (href !== currentHref) {
			setOptimisticFilters(next);
			setDateDraft(toDateRange(next));
		}

		navigate(href);
	};

	// A real stay needs at least one night, so `to` must be strictly after
	// `from`. react-day-picker reports an in-progress single-day pick as
	// `from === to`; committing that would navigate to a zero-night (dateless)
	// URL and flash the results, so we treat only multi-night ranges as final.
	const isCompleteRange = (range: DateRange | undefined): boolean =>
		Boolean(range?.from && range.to && range.to > range.from);

	const commitDates = (range: DateRange | undefined) => {
		setDateOpen(false);
		setDateDraft(undefined);

		const complete = isCompleteRange(range);
		// An in-progress single-day pick is discarded on close rather than
		// clearing an existing committed range.
		if (range?.from && !complete) return;

		const checkIn =
			complete && range?.from ? format(range.from, "yyyy-MM-dd") : null;
		const checkOut =
			complete && range?.to ? format(range.to, "yyyy-MM-dd") : null;
		if (
			checkIn === visibleFilters.checkIn &&
			checkOut === visibleFilters.checkOut
		) {
			return;
		}

		apply({ ...visibleFilters, checkIn, checkOut });
	};

	const handleDateChange = (range: DateRange | undefined) => {
		setDateDraft(range);
		if (isCompleteRange(range)) commitDates(range);
	};

	const currentGuests: GuestCounts = {
		adults: visibleFilters.adults,
		children: visibleFilters.children,
		infants: visibleFilters.infants,
	};

	// Edit guests in a draft while the popover is open and commit once on close,
	// so stepping up/down does not fire a navigation (and close the popover) on
	// every click.
	const handleGuestOpenChange = (open: boolean) => {
		if (open) {
			setGuestDraft(currentGuests);
			setGuestOpen(true);
			return;
		}

		const next = guestDraft;
		setGuestDraft(null);
		setGuestOpen(false);
		if (
			next &&
			(next.adults !== currentGuests.adults ||
				next.children !== currentGuests.children ||
				next.infants !== currentGuests.infants)
		) {
			apply({ ...visibleFilters, ...next });
		}
	};

	// Both dialogs edit the shared `draft`, seeded from the committed filters on
	// open; only one is open at a time so they don't clash. The pill opens the
	// search dialog (where/when/who); the Filters button opens the rest.
	const openSearch = () => {
		setDraft(visibleFilters);
		setSearchOpen(true);
	};
	const openFilters = () => {
		setDraft(visibleFilters);
		setShowAllAmenities(false);
		setSheetOpen(true);
	};
	const clearAll = () =>
		apply({ ...DEFAULT_HOMES_FILTERS, sort: visibleFilters.sort });

	const advancedCount = countAdvancedFilters(visibleFilters);
	const hasActiveFilters =
		advancedCount > 0 ||
		visibleFilters.place !== null ||
		visibleFilters.checkIn !== null ||
		visibleFilters.adults > 1 ||
		visibleFilters.children > 0;
	const draftCount = countAdvancedFilters(draft);
	const draftDates = toDateRange(draft);
	const draftDatesLabel = draftDates?.from
		? draftDates.to
			? `${format(draftDates.from, "MMM d")} - ${format(draftDates.to, "MMM d")}`
			: format(draftDates.from, "MMM d")
		: "Any week";
	const draftGuestTotal = draft.adults + draft.children;
	const draftGuestsLabel = `${draftGuestTotal} ${draftGuestTotal === 1 ? "guest" : "guests"}`;
	const draftPlaceLabel = findLocationPreset(draft.place)?.label ?? "Anywhere";
	const formatPrice = (amount: number) => formatListingMoney(amount, currency);
	const hasPriceRange =
		priceBounds !== null && priceBounds.max > priceBounds.min;
	const priceValue: [number, number] = priceBounds
		? [draft.priceMin ?? priceBounds.min, draft.priceMax ?? priceBounds.max]
		: [0, 0];
	const handlePriceChange = (values: number[]) => {
		if (!priceBounds) return;
		const min = values[0] ?? priceBounds.min;
		const max = values[1] ?? priceBounds.max;
		setDraft((current) => ({
			...current,
			priceMax: max < priceBounds.max ? max : null,
			priceMin: min > priceBounds.min ? min : null,
		}));
	};
	const visibleAmenities = showAllAmenities
		? amenityFacets
		: amenityFacets.slice(0, AMENITY_PREVIEW_COUNT);

	const toggleAmenity = (key: string) =>
		setDraft((current) => ({
			...current,
			amenities: current.amenities.includes(key)
				? current.amenities.filter((value) => value !== key)
				: [...current.amenities, key],
		}));

	const clearAdvanced = () =>
		setDraft((current) => ({
			...current,
			amenities: [],
			bathroomsMin: null,
			bedroomsMin: null,
			priceMax: null,
			priceMin: null,
			ratingMin: null,
		}));

	const amenityLabels = new Map(
		amenityFacets.map((amenity) => [amenity.key, amenity.label]),
	);
	const activeChips: { key: string; label: string; remove: () => void }[] = [];
	const preset = findLocationPreset(visibleFilters.place);
	const summaryPlace = preset?.label ?? "Anywhere";
	const summaryDates = visibleFilters.checkIn
		? visibleFilters.checkOut
			? `${format(parseISO(visibleFilters.checkIn), "MMM d")} - ${format(parseISO(visibleFilters.checkOut), "MMM d")}`
			: format(parseISO(visibleFilters.checkIn), "MMM d")
		: "Any week";
	const summaryGuests =
		visibleFilters.adults > 1 || visibleFilters.children > 0
			? `${visibleFilters.adults + visibleFilters.children} guests`
			: "Add guests";
	if (preset) {
		activeChips.push({
			key: "place",
			label: preset.label,
			remove: () => apply({ ...visibleFilters, place: null }),
		});
	}
	if (visibleFilters.checkIn) {
		const from = parseISO(visibleFilters.checkIn);
		const to = visibleFilters.checkOut
			? parseISO(visibleFilters.checkOut)
			: null;
		activeChips.push({
			key: "dates",
			label: to
				? `${format(from, "MMM d")} - ${format(to, "MMM d")}`
				: format(from, "MMM d"),
			remove: () => apply({ ...visibleFilters, checkIn: null, checkOut: null }),
		});
	}
	if (visibleFilters.adults > 1 || visibleFilters.children > 0) {
		const guests = visibleFilters.adults + visibleFilters.children;
		activeChips.push({
			key: "guests",
			label: `${guests} ${guests === 1 ? "guest" : "guests"}`,
			remove: () =>
				apply({ ...visibleFilters, adults: 1, children: 0, infants: 0 }),
		});
	}
	if (visibleFilters.ratingMin !== null) {
		activeChips.push({
			key: "rating",
			label: `${visibleFilters.ratingMin}+ rating`,
			remove: () => apply({ ...visibleFilters, ratingMin: null }),
		});
	}
	if (visibleFilters.bedroomsMin !== null) {
		activeChips.push({
			key: "beds",
			label: `${visibleFilters.bedroomsMin}+ bed`,
			remove: () => apply({ ...visibleFilters, bedroomsMin: null }),
		});
	}
	if (visibleFilters.bathroomsMin !== null) {
		activeChips.push({
			key: "baths",
			label: `${visibleFilters.bathroomsMin}+ bath`,
			remove: () => apply({ ...visibleFilters, bathroomsMin: null }),
		});
	}
	if (visibleFilters.priceMin !== null || visibleFilters.priceMax !== null) {
		const min = visibleFilters.priceMin;
		const max = visibleFilters.priceMax;
		const label =
			min !== null && max !== null
				? `${formatPrice(min)} - ${formatPrice(max)}`
				: min !== null
					? `${formatPrice(min)}+`
					: `Up to ${formatPrice(max as number)}`;
		activeChips.push({
			key: "price",
			label: `${label} / night`,
			remove: () =>
				apply({ ...visibleFilters, priceMax: null, priceMin: null }),
		});
	}
	for (const key of visibleFilters.amenities) {
		activeChips.push({
			key: `amenity-${key}`,
			label: amenityLabels.get(key) ?? key,
			remove: () =>
				apply({
					...visibleFilters,
					amenities: visibleFilters.amenities.filter((value) => value !== key),
				}),
		});
	}

	const sortOptions = [
		{
			icon: <Sparkles className="text-muted-foreground" />,
			label: "Newest",
			value: "recent",
		},
		...(visibleFilters.place
			? [
					{
						icon: <MapPin className="text-muted-foreground" />,
						label: "Nearest",
						value: "distance",
					},
				]
			: []),
		{
			icon: <ArrowUpNarrowWide className="text-muted-foreground" />,
			label: "Price: low to high",
			value: "price_asc",
		},
		{
			icon: <ArrowDownWideNarrow className="text-muted-foreground" />,
			label: "Price: high to low",
			value: "price_desc",
		},
		{
			icon: <Maximize2 className="text-muted-foreground" />,
			label: "Largest",
			value: "capacity",
		},
		{
			icon: <ArrowDownAZ className="text-muted-foreground" />,
			label: "A to Z",
			value: "name",
		},
	];

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2 sm:hidden">
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="shrink-0 rounded-full"
					onClick={clearAll}
					disabled={!hasActiveFilters}
					aria-label="Clear all filters"
				>
					<ArrowLeft className="size-5" />
				</Button>
				<button
					type="button"
					onClick={openSearch}
					className="flex flex-1 flex-col items-center rounded-full border bg-card px-4 py-2 text-center shadow-sm"
				>
					<span className="font-medium text-sm">{summaryPlace}</span>
					<span className="text-muted-foreground text-xs">
						{summaryDates} · {summaryGuests}
					</span>
				</button>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="relative shrink-0 rounded-full"
					onClick={openFilters}
					aria-label="Filters"
				>
					<SlidersHorizontal className="size-4" />
					{advancedCount > 0 && (
						<span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary" />
					)}
				</Button>
			</div>

			<div className="hidden items-center gap-2 rounded-full border bg-card p-2 shadow-sm sm:flex">
				<DateRangeField
					className="flex-1"
					open={dateOpen}
					onOpenChange={(open) => {
						if (open) {
							setDateDraft(committedDateRange);
							setDateOpen(true);
							return;
						}
						commitDates(dateDraft);
					}}
					value={dateOpen ? dateDraft : committedDateRange}
					onChange={handleDateChange}
				/>
				<Separator orientation="vertical" className="h-8" />
				<GuestSelector
					className="flex-1"
					open={guestOpen}
					onOpenChange={handleGuestOpenChange}
					value={guestDraft ?? currentGuests}
					onChange={setGuestDraft}
				/>
				<Button
					type="button"
					variant="outline"
					className="rounded-full"
					onClick={openFilters}
				>
					<SlidersHorizontal className="size-4" />
					Filters
					{advancedCount > 0 && (
						<Badge variant="secondary" className="ml-1">
							{advancedCount}
						</Badge>
					)}
				</Button>
			</div>

			<Dialog
				open={searchOpen}
				onOpenChange={(open) => {
					if (open) setDraft(visibleFilters);
					setSearchOpen(open);
				}}
			>
				<DialogContent
					showCloseButton={false}
					className="flex max-h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-xl"
				>
					<DialogHeader className="relative flex-row items-center justify-center border-b px-12 py-4">
						<DialogClose asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								className="absolute left-3"
							>
								<X className="size-4" />
								<span className="sr-only">Close</span>
							</Button>
						</DialogClose>
						<DialogTitle>Search</DialogTitle>
						<DialogDescription className="sr-only">
							Choose where, when and how many guests.
						</DialogDescription>
					</DialogHeader>

					<div className="flex-1 overflow-y-auto px-6 py-6">
						<Accordion type="single" collapsible defaultValue="where">
							<AccordionItem value="where">
								<AccordionTrigger>
									<span className="flex flex-col gap-0.5">
										<span className="font-heading text-base">Where</span>
										<span className="font-normal text-muted-foreground text-xs">
											{draftPlaceLabel}
										</span>
									</span>
								</AccordionTrigger>
								<AccordionContent>
									<div className="flex flex-wrap gap-2">
										<FilterPill
											active={draft.place === null}
											onClick={() => setDraft({ ...draft, place: null })}
										>
											Anywhere
										</FilterPill>
										{CATALOG_LOCATION_PRESETS.map((location) => (
											<FilterPill
												key={location.id}
												active={draft.place === location.id}
												onClick={() =>
													setDraft({ ...draft, place: location.id })
												}
											>
												{location.label}
											</FilterPill>
										))}
									</div>
								</AccordionContent>
							</AccordionItem>
							<AccordionItem value="when">
								<AccordionTrigger>
									<span className="flex flex-col gap-0.5">
										<span className="font-heading text-base">When</span>
										<span className="font-normal text-muted-foreground text-xs">
											{draftDatesLabel}
										</span>
									</span>
								</AccordionTrigger>
								<AccordionContent className="h-auto">
									<div className="flex justify-center">
										<StayCalendar
											numberOfMonths={1}
											value={draftDates}
											onChange={(range) =>
												setDraft({
													...draft,
													checkIn: range?.from
														? format(range.from, "yyyy-MM-dd")
														: null,
													checkOut: range?.to
														? format(range.to, "yyyy-MM-dd")
														: null,
												})
											}
										/>
									</div>
								</AccordionContent>
							</AccordionItem>
							<AccordionItem value="who">
								<AccordionTrigger>
									<span className="flex flex-col gap-0.5">
										<span className="font-heading text-base">Who</span>
										<span className="font-normal text-muted-foreground text-xs">
											{draftGuestsLabel}
										</span>
									</span>
								</AccordionTrigger>
								<AccordionContent>
									<GuestFields
										value={{
											adults: draft.adults,
											children: draft.children,
											infants: draft.infants,
										}}
										onChange={(next) => setDraft({ ...draft, ...next })}
									/>
								</AccordionContent>
							</AccordionItem>
						</Accordion>
					</div>

					<DialogFooter className="flex-row items-center justify-between border-t px-6 py-4">
						<Button
							type="button"
							variant="ghost"
							className="px-2 underline underline-offset-4"
							disabled={!hasActiveFilters}
							onClick={clearAll}
						>
							Clear all
						</Button>
						<DialogClose asChild>
							<Button type="button" onClick={() => apply(draft)}>
								Search
							</Button>
						</DialogClose>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={sheetOpen}
				onOpenChange={(open) => {
					if (open) {
						setDraft(visibleFilters);
						setShowAllAmenities(false);
					}
					setSheetOpen(open);
				}}
			>
				<DialogContent
					showCloseButton={false}
					className="flex max-h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-xl"
				>
					<DialogHeader className="relative flex-row items-center justify-center border-b px-12 py-4">
						<DialogClose asChild>
							<Button
								variant="ghost"
								size="icon-sm"
								className="absolute left-3"
							>
								<X className="size-4" />
								<span className="sr-only">Close</span>
							</Button>
						</DialogClose>
						<DialogTitle>Filters</DialogTitle>
						<DialogDescription className="sr-only">
							Refine homes by rooms, guest rating and amenities.
						</DialogDescription>
					</DialogHeader>

					<div className="flex-1 divide-y overflow-y-auto px-6">
						{hasPriceRange && priceBounds && (
							<FilterSection title="Price per night">
								<div className="flex flex-col gap-5 px-1 pt-2">
									<Slider
										min={priceBounds.min}
										max={priceBounds.max}
										value={priceValue}
										onValueChange={handlePriceChange}
										minStepsBetweenThumbs={1}
									/>
									<div className="flex items-center justify-between gap-3">
										<div className="flex flex-col rounded-xl border px-3 py-2">
											<span className="text-muted-foreground text-xs">
												Minimum
											</span>
											<span className="font-medium text-sm">
												{formatPrice(priceValue[0])}
											</span>
										</div>
										<div className="flex flex-col rounded-xl border px-3 py-2 text-right">
											<span className="text-muted-foreground text-xs">
												Maximum
											</span>
											<span className="font-medium text-sm">
												{formatPrice(priceValue[1])}
												{priceValue[1] >= priceBounds.max ? "+" : ""}
											</span>
										</div>
									</div>
									<p className="text-muted-foreground text-xs">
										Estimated nightly rate, before fees.
									</p>
								</div>
							</FilterSection>
						)}

						<FilterSection title="Rooms">
							<div className="flex flex-col gap-3">
								<p className="font-medium text-muted-foreground text-sm">
									Bedrooms
								</p>
								<PillRow
									options={ROOM_OPTIONS}
									value={draft.bedroomsMin}
									onChange={(bedroomsMin) =>
										setDraft({ ...draft, bedroomsMin })
									}
								/>
							</div>
							<div className="flex flex-col gap-3">
								<p className="font-medium text-muted-foreground text-sm">
									Bathrooms
								</p>
								<PillRow
									options={ROOM_OPTIONS}
									value={draft.bathroomsMin}
									onChange={(bathroomsMin) =>
										setDraft({ ...draft, bathroomsMin })
									}
								/>
							</div>
						</FilterSection>

						<FilterSection title="Guest rating">
							<PillRow
								options={RATING_OPTIONS}
								value={draft.ratingMin}
								onChange={(ratingMin) => setDraft({ ...draft, ratingMin })}
							/>
						</FilterSection>

						{amenityFacets.length > 0 && (
							<FilterSection title="Amenities">
								<div className="flex flex-wrap gap-2">
									{visibleAmenities.map((amenity) => (
										<FilterPill
											key={amenity.key}
											active={draft.amenities.includes(amenity.key)}
											onClick={() => toggleAmenity(amenity.key)}
										>
											<span className="flex items-center gap-2">
												<AmenityIcon name={amenity.icon} className="size-4" />
												{amenity.label}
											</span>
										</FilterPill>
									))}
								</div>
								{amenityFacets.length > AMENITY_PREVIEW_COUNT && (
									<Button
										type="button"
										variant="link"
										className="w-fit px-0 text-foreground"
										onClick={() => setShowAllAmenities((value) => !value)}
									>
										{showAllAmenities
											? "Show less"
											: `Show all ${amenityFacets.length} amenities`}
									</Button>
								)}
							</FilterSection>
						)}
					</div>

					<DialogFooter className="flex-row items-center justify-between border-t px-6 py-4">
						<Button
							type="button"
							variant="ghost"
							className="px-2 underline underline-offset-4"
							disabled={draftCount === 0}
							onClick={clearAdvanced}
						>
							Clear all
						</Button>
						<DialogClose asChild>
							<Button type="button" onClick={() => apply(draft)}>
								Show homes
							</Button>
						</DialogClose>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{activeChips.length > 0 && (
				<div className="flex flex-wrap items-center gap-2">
					{activeChips.map((chip) => (
						<span
							key={chip.key}
							className="inline-flex items-center gap-1 rounded-full border bg-card py-1 pr-1 pl-3 text-sm shadow-sm"
						>
							{chip.label}
							<button
								type="button"
								onClick={chip.remove}
								aria-label={`Remove ${chip.label}`}
								className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								<X className="size-3.5" />
							</button>
						</span>
					))}
					<button
						type="button"
						onClick={() =>
							apply({ ...DEFAULT_HOMES_FILTERS, sort: visibleFilters.sort })
						}
						className="px-2 text-muted-foreground text-sm underline underline-offset-4 transition-colors hover:text-foreground"
					>
						Clear all
					</button>
				</div>
			)}

			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
				<p className="font-medium text-sm">
					Displaying {total} {total === 1 ? "home" : "homes"}
				</p>
				<div className="flex items-center gap-2">
					<span className="text-muted-foreground text-sm">Sort by</span>
					<ResponsiveSelect
						aria-label="Sort by"
						className={cn("min-w-40")}
						onValueChange={(sort) => apply({ ...visibleFilters, sort })}
						options={sortOptions}
						placeholder="Sort"
						size="sm"
						value={visibleFilters.sort ?? "recent"}
					/>
				</div>
			</div>
		</div>
	);
}
