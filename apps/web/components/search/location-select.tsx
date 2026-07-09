"use client";

import { ResponsiveSelect } from "@workspace/ui/components/responsive-select";
import { cn } from "@workspace/ui/lib/utils";
import { MapPin } from "lucide-react";
import { CATALOG_LOCATION_PRESETS } from "@/lib/catalog/locations";

interface LocationSelectProps {
	className?: string;
	onChange: (value: string | null) => void;
	triggerClassName?: string;
	value: string | null;
}

const LOCATION_OPTIONS = [
	{ label: "Anywhere", value: "" },
	...CATALOG_LOCATION_PRESETS.map((preset) => ({
		label: preset.label,
		value: preset.id,
	})),
];

export function LocationSelect({
	className,
	onChange,
	triggerClassName,
	value,
}: LocationSelectProps) {
	return (
		<div className={cn("flex items-center gap-2 px-3", className)}>
			<MapPin className="size-4 shrink-0 text-muted-foreground" />
			<div className="flex w-full flex-col items-start justify-center">
				<span className="font-medium text-muted-foreground text-xs">Where</span>
				<ResponsiveSelect
					className="w-full"
					nativeSelectClassName="h-auto border-0 bg-transparent p-0 pr-6 shadow-none dark:bg-transparent dark:hover:bg-transparent"
					onValueChange={(next) => onChange(next === "" ? null : next)}
					options={LOCATION_OPTIONS}
					triggerClassName={cn(
						"h-auto w-full justify-start gap-1 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 data-[size=default]:h-auto dark:bg-transparent dark:hover:bg-transparent",
						triggerClassName,
					)}
					value={value ?? ""}
				/>
			</div>
		</div>
	);
}
