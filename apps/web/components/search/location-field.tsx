"use client";

import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { MapPin } from "lucide-react";

interface LocationFieldProps {
	className?: string;
	id?: string;
	onChange: (value: string) => void;
	value: string;
}

export function LocationField({
	className,
	id = "stay-location",
	onChange,
	value,
}: LocationFieldProps) {
	return (
		<div className={cn("flex items-center gap-2 px-3", className)}>
			<MapPin className="size-4 shrink-0 text-muted-foreground" />
			<div className="group flex w-full flex-col items-start justify-center">
				<label
					htmlFor={id}
					className="max-h-5 overflow-hidden font-medium text-muted-foreground text-xs opacity-100 transition-all duration-200 ease-out group-focus-within:max-h-0 group-focus-within:opacity-0"
				>
					Where
				</label>
				<Input
					id={id}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					placeholder="City or property"
					className="h-auto border-0 bg-transparent py-0 pr-0 pl-1 text-sm shadow-none transition-all duration-200 ease-out focus-visible:ring-0 group-focus-within:py-1 dark:bg-transparent"
				/>
			</div>
		</div>
	);
}
