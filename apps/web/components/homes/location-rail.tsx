"use client";

import { cn } from "@workspace/ui/lib/utils";
import { MapPin } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { buildHomesHref, parseHomesFilters } from "@/lib/catalog/homes-filters";
import { CATALOG_LOCATION_PRESETS } from "@/lib/catalog/locations";
import { useHomesPending } from "./homes-pending";

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

export function LocationRail() {
	const { isPending, navigate } = useHomesPending();
	const searchParams = useSearchParams();
	const committedPlace = searchParams.get("place");

	// Highlight the selection optimistically so the active pill updates instantly
	// while the navigation transition is in flight. We remember which committed
	// value the optimistic pick was made against and drop it once the URL catches
	// up or the transition completes.
	const [optimistic, setOptimistic] = useState<{
		from: string | null;
		place: string | null;
	} | null>(null);

	// Clear optimistic state when the committed place changes or transition completes
	useEffect(() => {
		if (optimistic && (optimistic.from !== committedPlace || !isPending)) {
			setOptimistic(null);
		}
	}, [committedPlace, isPending, optimistic]);

	const place = optimistic ? optimistic.place : committedPlace;

	const select = (id: string | null) => {
		setOptimistic({ from: committedPlace, place: id });
		const filters = parseHomesFilters(
			new URLSearchParams(searchParams.toString()),
		);
		navigate(buildHomesHref({ ...filters, place: id }));
	};

	return (
		<div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
			<RailChip active={!place} onClick={() => select(null)}>
				<span className="flex items-center gap-1.5">
					<MapPin className="size-3.5" />
					All areas
				</span>
			</RailChip>
			{CATALOG_LOCATION_PRESETS.map((preset) => (
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
