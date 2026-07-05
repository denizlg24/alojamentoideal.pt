"use client";

import { cn } from "@workspace/ui/lib/utils";
import { MapPin } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
	buildActivitiesHref,
	parseActivitiesFilters,
} from "@/lib/activities/filters";
import { CATALOG_LOCATION_PRESETS } from "@/lib/catalog/locations";
import { useActivitiesPending } from "./activities-pending";

function RailChip({
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
				"shrink-0 whitespace-nowrap rounded-full border px-4 py-2 font-medium text-sm transition-colors",
				active
					? "border-primary bg-primary text-primary-foreground shadow-sm"
					: "border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent",
			)}
		>
			{children}
		</button>
	);
}

/**
 * Service-area rail. Only presets that actually have activities are offered, so
 * the operator's small collection never shows an empty area.
 */
export function ActivitiesLocationRail({ placeIds }: { placeIds: string[] }) {
	const { isPending, navigate } = useActivitiesPending();
	const searchParams = useSearchParams();
	const committedPlace = searchParams.get("place");

	const [optimistic, setOptimistic] = useState<{
		from: string | null;
		place: string | null;
	} | null>(null);

	useEffect(() => {
		if (optimistic && (optimistic.from !== committedPlace || !isPending)) {
			setOptimistic(null);
		}
	}, [committedPlace, isPending, optimistic]);

	const place = optimistic ? optimistic.place : committedPlace;
	const presets = CATALOG_LOCATION_PRESETS.filter((preset) =>
		placeIds.includes(preset.id),
	);

	if (presets.length === 0) return null;

	const select = (id: string | null) => {
		setOptimistic({ from: committedPlace, place: id });
		const filters = parseActivitiesFilters(
			new URLSearchParams(searchParams.toString()),
		);
		navigate(buildActivitiesHref({ ...filters, place: id }));
	};

	return (
		<div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
			<RailChip active={!place} onClick={() => select(null)}>
				<span className="flex items-center gap-1.5">
					<MapPin className="size-3.5" />
					All areas
				</span>
			</RailChip>
			{presets.map((preset) => (
				<RailChip
					key={preset.id}
					active={place === preset.id}
					onClick={() => select(place === preset.id ? null : preset.id)}
				>
					{preset.label}
				</RailChip>
			))}
		</div>
	);
}
