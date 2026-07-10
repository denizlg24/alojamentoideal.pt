"use client";

import { Button } from "@workspace/ui/components/button";
import { Calendar } from "@workspace/ui/components/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { format } from "date-fns";
import { CalendarDays, X } from "lucide-react";
import { useMemo } from "react";
import type { DateRange } from "react-day-picker";

interface DateRangeProps {
	onChange: (next: DateRange | undefined) => void;
	value: DateRange | undefined;
}

function startOfToday() {
	return new Date(new Date().toDateString());
}

function formatRange(value: DateRange | undefined): string | null {
	if (!value?.from) return null;
	if (!value.to) return format(value.from, "LLL d");
	return `${format(value.from, "LLL d")} to ${format(value.to, "LLL d")}`;
}

export function StayCalendar({
	numberOfMonths = 1,
	onChange,
	value,
}: DateRangeProps & { numberOfMonths?: number }) {
	const today = useMemo(() => startOfToday(), []);

	return (
		<div className="flex flex-col gap-1">
			<Calendar
				className="w-full! bg-transparent"
				mode="range"
				showOutsideDays={false}
				numberOfMonths={numberOfMonths}
				defaultMonth={value?.from}
				selected={value}
				onSelect={onChange}
				disabled={(date) => date < today}
			/>
			{value?.from && (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => onChange(undefined)}
					className="mx-auto h-8 gap-1.5 text-muted-foreground text-xs"
				>
					<X className="size-3.5" />
					Clear dates
				</Button>
			)}
		</div>
	);
}

export function DateRangeField({
	className,
	onChange,
	onOpenChange,
	open,
	value,
}: DateRangeProps & {
	className?: string;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
}) {
	const label = formatRange(value);

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
					<CalendarDays className="size-4 shrink-0 text-muted-foreground" />
					<span className="flex flex-col items-start">
						<span className="font-medium text-muted-foreground text-xs">
							Dates
						</span>
						<span className={cn("text-sm", !label && "text-muted-foreground")}>
							{label ?? "Add dates"}
						</span>
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto p-2">
				<StayCalendar value={value} onChange={onChange} numberOfMonths={2} />
			</PopoverContent>
		</Popover>
	);
}
