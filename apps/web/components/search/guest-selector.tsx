"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { Minus, Plus, Users } from "lucide-react";
import { MAX_INFANTS } from "@/lib/catalog/guests";

export interface GuestCounts {
	adults: number;
	children: number;
	infants: number;
}

interface GuestFieldsProps {
	onChange: (next: GuestCounts) => void;
	value: GuestCounts;
}

const MIN_ADULTS = 1;
const MAX_PER_CATEGORY = 20;

function Stepper({
	hint,
	label,
	max,
	min,
	onChange,
	value,
}: {
	hint: string;
	label: string;
	max: number;
	min: number;
	onChange: (next: number) => void;
	value: number;
}) {
	return (
		<div className="flex items-center justify-between gap-4 py-2">
			<div className="flex flex-col">
				<span className="font-medium text-sm">{label}</span>
				<span className="text-muted-foreground text-xs">{hint}</span>
			</div>
			<div className="flex items-center gap-3">
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="size-8 rounded-full"
					onClick={() => onChange(Math.max(min, value - 1))}
					disabled={value <= min}
					aria-label={`Decrease ${label}`}
				>
					<Minus className="size-4" />
				</Button>
				<span className="w-5 text-center text-sm tabular-nums">{value}</span>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="size-8 rounded-full"
					onClick={() => onChange(Math.min(max, value + 1))}
					disabled={value >= max}
					aria-label={`Increase ${label}`}
				>
					<Plus className="size-4" />
				</Button>
			</div>
		</div>
	);
}

export function GuestFields({ onChange, value }: GuestFieldsProps) {
	return (
		<div className="flex flex-col">
			<Stepper
				label="Adults"
				hint="Ages 13 or above"
				value={value.adults}
				min={MIN_ADULTS}
				max={MAX_PER_CATEGORY}
				onChange={(adults) => onChange({ ...value, adults })}
			/>
			<Stepper
				label="Children"
				hint="Ages 2 to 12"
				value={value.children}
				min={0}
				max={MAX_PER_CATEGORY}
				onChange={(children) => onChange({ ...value, children })}
			/>
			<Stepper
				label="Infants"
				hint="Under 2"
				value={value.infants}
				min={0}
				max={MAX_INFANTS}
				onChange={(infants) => onChange({ ...value, infants })}
			/>
		</div>
	);
}

export function GuestSelector({
	className,
	onChange,
	onOpenChange,
	open,
	value,
}: GuestFieldsProps & {
	className?: string;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
}) {
	const total = value.adults + value.children;

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					className={cn(
						"h-auto justify-start gap-2 px-3 font-normal hover:bg-accent/60",
						className,
					)}
				>
					<Users className="size-4 shrink-0 text-muted-foreground" />
					<span className="flex flex-col items-start">
						<span className="font-medium text-muted-foreground text-xs">
							Guests
						</span>
						<span className="text-sm">
							{total} {total === 1 ? "guest" : "guests"}
						</span>
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 p-4">
				<GuestFields value={value} onChange={onChange} />
			</PopoverContent>
		</Popover>
	);
}
