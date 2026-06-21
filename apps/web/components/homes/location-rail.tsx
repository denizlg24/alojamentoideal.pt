"use client";

import { cn } from "@workspace/ui/lib/utils";
import { MapPin } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildHomesHref, parseHomesFilters } from "@/lib/catalog/homes-filters";
import { CATALOG_LOCATION_PRESETS } from "@/lib/catalog/locations";

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
	const router = useRouter();
	const searchParams = useSearchParams();
	const place = searchParams.get("place");

	const select = (id: string | null) => {
		const filters = parseHomesFilters(
			new URLSearchParams(searchParams.toString()),
		);
		router.push(buildHomesHref({ ...filters, place: id }));
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
