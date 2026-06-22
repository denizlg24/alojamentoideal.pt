"use client";

import { Calendar, CalendarDayButton } from "@workspace/ui/components/calendar";
import { cn } from "@workspace/ui/lib/utils";
import { useMemo } from "react";
import type { DateRange } from "react-day-picker";
import { toIsoDate } from "@/lib/catalog/dates";
import {
	isListingCalendarDateDisabled,
	isListingCalendarDateUnavailable,
} from "@/lib/catalog/listing-calendar-availability";

/**
 * Range picker that crosses out nights the synced calendar marks unavailable and
 * blocks them from selection. `availableDates: null` means the listing has no
 * synced calendar, so nothing is restricted and the live quote validates the
 * stay instead. `excludeDisabled` keeps a dragged range from spanning a blocked
 * night.
 */
export function ListingCalendar({
	availableDates,
	numberOfMonths = 1,
	onChange,
	value,
}: {
	availableDates: string[] | null;
	numberOfMonths?: number;
	onChange: (range: DateRange | undefined) => void;
	value: DateRange | undefined;
}) {
	const today = useMemo(() => new Date(new Date().toDateString()), []);
	const availableSet = useMemo(
		() => (availableDates ? new Set(availableDates) : null),
		[availableDates],
	);
	const selection = {
		checkIn: value?.from ? toIsoDate(value.from) : null,
		checkOut: value?.to ? toIsoDate(value.to) : null,
	};

	const isDisabled = (date: Date) =>
		date < today ||
		isListingCalendarDateDisabled(toIsoDate(date), availableSet, selection);

	const isUnavailable = (date: Date) =>
		isListingCalendarDateUnavailable(toIsoDate(date), availableSet, selection);

	return (
		<Calendar
			mode="range"
			excludeDisabled
			showOutsideDays={false}
			numberOfMonths={numberOfMonths}
			defaultMonth={value?.from ?? today}
			selected={value}
			onSelect={onChange}
			disabled={isDisabled}
			startMonth={today}
			modifiers={{
				unavailable: (date) => date >= today && isUnavailable(date),
			}}
			modifiersClassNames={{ unavailable: "line-through opacity-50" }}
			components={{
				DayButton: (props) => (
					<CalendarDayButton
						{...props}
						className={cn(
							props.className,
							props.modifiers.unavailable && "line-through opacity-50",
						)}
					/>
				),
			}}
		/>
	);
}
