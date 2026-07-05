"use client";

import {
	type ActivityDifficulty,
	type ActivityDurationBucket,
	difficultyLabel,
	durationBucketLabel,
} from "@workspace/core/activities";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@workspace/ui/components/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { Separator } from "@workspace/ui/components/separator";
import { Slider } from "@workspace/ui/components/slider";
import { cn } from "@workspace/ui/lib/utils";
import { SlidersHorizontal } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
	ACTIVITIES_SORTS,
	type ActivitiesFacets,
	type ActivitiesFilters,
	type ActivitiesSort,
	buildActivitiesHref,
	countActivitiesFilters,
	parseActivitiesFilters,
} from "@/lib/activities/filters";
import { formatListingMoney } from "@/lib/catalog/pricing-display";
import { useActivitiesPending } from "./activities-pending";

function Pill({
	active,
	children,
	onClick,
}: {
	active: boolean;
	children: React.ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={cn(
				"rounded-full border px-3 py-1.5 font-medium text-sm transition-colors",
				active
					? "border-primary bg-primary text-primary-foreground"
					: "border-border bg-card hover:border-primary/40 hover:bg-accent",
			)}
		>
			{children}
		</button>
	);
}

function toggle<T>(list: T[], value: T): T[] {
	return list.includes(value)
		? list.filter((entry) => entry !== value)
		: [...list, value];
}

export function ActivitiesFilterBar({ facets }: { facets: ActivitiesFacets }) {
	const { navigate } = useActivitiesPending();
	const searchParams = useSearchParams();
	const filters = useMemo(
		() => parseActivitiesFilters(new URLSearchParams(searchParams.toString())),
		[searchParams],
	);

	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<ActivitiesFilters>(filters);

	const activeCount = countActivitiesFilters(filters);
	const bounds = facets.priceBounds;
	const priceCurrency = facets.priceCurrency;

	const openDialog = (next: boolean) => {
		if (next) setDraft(filters);
		setOpen(next);
	};

	const commit = (next: ActivitiesFilters) => {
		navigate(buildActivitiesHref(next));
	};

	const changeSort = (sort: ActivitiesSort) => {
		commit({ ...filters, sort });
	};

	const applyDraft = () => {
		commit(draft);
		setOpen(false);
	};

	const resetDraft = () => {
		setDraft({
			...draft,
			difficulties: [],
			durations: [],
			priceMin: null,
			priceMax: null,
		});
	};

	const priceRange: [number, number] = bounds
		? [draft.priceMin ?? bounds.min, draft.priceMax ?? bounds.max]
		: [0, 0];

	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<Dialog open={open} onOpenChange={openDialog}>
				<DialogTrigger asChild>
					<Button variant="outline" className="gap-2">
						<SlidersHorizontal className="size-4" />
						Filters
						{activeCount > 0 && (
							<Badge variant="secondary" className="ml-1">
								{activeCount}
							</Badge>
						)}
					</Button>
				</DialogTrigger>
				<DialogContent className="max-h-[85vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Filter activities</DialogTitle>
					</DialogHeader>

					<div className="flex flex-col gap-6 py-2">
						{facets.difficulties.length > 0 && (
							<section className="flex flex-col gap-3">
								<h3 className="font-medium text-sm">Difficulty</h3>
								<div className="flex flex-wrap gap-2">
									{facets.difficulties.map((value: ActivityDifficulty) => (
										<Pill
											key={value}
											active={draft.difficulties.includes(value)}
											onClick={() =>
												setDraft((current) => ({
													...current,
													difficulties: toggle(current.difficulties, value),
												}))
											}
										>
											{difficultyLabel(value)}
										</Pill>
									))}
								</div>
							</section>
						)}

						{facets.durations.length > 0 && (
							<section className="flex flex-col gap-3">
								<h3 className="font-medium text-sm">Duration</h3>
								<div className="flex flex-wrap gap-2">
									{facets.durations.map((value: ActivityDurationBucket) => (
										<Pill
											key={value}
											active={draft.durations.includes(value)}
											onClick={() =>
												setDraft((current) => ({
													...current,
													durations: toggle(current.durations, value),
												}))
											}
										>
											{durationBucketLabel(value)}
										</Pill>
									))}
								</div>
							</section>
						)}

						{bounds && bounds.max > bounds.min && (
							<section className="flex flex-col gap-3">
								<div className="flex items-center justify-between">
									<h3 className="font-medium text-sm">Price per person</h3>
									<span className="text-muted-foreground text-sm">
										{formatListingMoney(priceRange[0], priceCurrency)} –{" "}
										{formatListingMoney(priceRange[1], priceCurrency)}
									</span>
								</div>
								<Slider
									min={bounds.min}
									max={bounds.max}
									step={1}
									value={priceRange}
									onValueChange={(values) => {
										const [min, max] = values;
										setDraft((current) => ({
											...current,
											priceMin:
												min === undefined || min <= bounds.min ? null : min,
											priceMax:
												max === undefined || max >= bounds.max ? null : max,
										}));
									}}
								/>
							</section>
						)}
					</div>

					<DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
						<Button variant="ghost" onClick={resetDraft}>
							Clear
						</Button>
						<Button onClick={applyDraft}>Show results</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<div className="flex items-center gap-2">
				<span className="hidden text-muted-foreground text-sm sm:inline">
					Sort
				</span>
				<Select value={filters.sort} onValueChange={changeSort}>
					<SelectTrigger className="w-[180px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{ACTIVITIES_SORTS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<Separator className="w-full" />
		</div>
	);
}
