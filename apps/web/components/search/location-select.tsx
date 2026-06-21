"use client";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { cn } from "@workspace/ui/lib/utils";
import { MapPin } from "lucide-react";
import { CATALOG_LOCATION_PRESETS } from "@/lib/catalog/locations";

interface LocationSelectProps {
	className?: string;
	onChange: (value: string | null) => void;
	triggerClassName?: string;
	value: string | null;
}

/** Sentinel for "no area selected"; Radix Select disallows an empty value. */
const ANY_VALUE = "__any__";

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
				<Select
					value={value ?? ANY_VALUE}
					onValueChange={(next) => onChange(next === ANY_VALUE ? null : next)}
				>
					<SelectTrigger
						className={cn(
							"h-auto w-full justify-start gap-1 border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 data-[size=default]:h-auto dark:bg-transparent dark:hover:bg-transparent",
							triggerClassName,
						)}
					>
						<SelectValue placeholder="Anywhere" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ANY_VALUE}>Anywhere</SelectItem>
						{CATALOG_LOCATION_PRESETS.map((preset) => (
							<SelectItem key={preset.id} value={preset.id}>
								{preset.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}
