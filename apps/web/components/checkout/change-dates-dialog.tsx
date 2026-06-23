"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { ListingCalendar } from "@/components/listings/detail/listing-calendar";
import { useBookingAvailability } from "@/components/listings/detail/use-booking-availability";
import { nightsBetween, parseIsoDate, toIsoDate } from "@/lib/catalog/dates";

export interface DateSelection {
	checkIn: string;
	checkOut: string;
}

interface ChangeDatesDialogProps {
	listingId: string;
	minNights: number;
	onOpenChange: (open: boolean) => void;
	onSave: (next: DateSelection) => void;
	open: boolean;
	saving: boolean;
	value: DateSelection | null;
}

/** Date editor reusing the listing calendar + synced availability window. */
export function ChangeDatesDialog({
	listingId,
	minNights,
	onOpenChange,
	onSave,
	open,
	saving,
	value,
}: ChangeDatesDialogProps) {
	const availabilityState = useBookingAvailability(listingId, minNights);
	const availability =
		availabilityState.status === "ready"
			? availabilityState.availability
			: null;
	const availableDates = availability?.availableDates ?? null;

	const [range, setRange] = useState<DateRange | undefined>(() =>
		value
			? { from: parseIsoDate(value.checkIn), to: parseIsoDate(value.checkOut) }
			: undefined,
	);

	useEffect(() => {
		if (open) {
			setRange(
				value
					? {
							from: parseIsoDate(value.checkIn),
							to: parseIsoDate(value.checkOut),
						}
					: undefined,
			);
		}
	}, [open, value]);

	const checkIn = range?.from ? toIsoDate(range.from) : null;
	const checkOut = range?.to ? toIsoDate(range.to) : null;
	const minStay = checkIn
		? (availability?.minStayByDate[checkIn] ?? minNights)
		: minNights;
	const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
	const tooShort = Boolean(checkIn && checkOut && nights < minStay);
	const canSave = Boolean(checkIn && checkOut) && !tooShort;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="rounded-2xl sm:max-w-fit">
				<DialogHeader>
					<DialogTitle>Change dates</DialogTitle>
					<DialogDescription>
						Pick new check-in and checkout dates for your stay.
					</DialogDescription>
				</DialogHeader>

				<div className="flex justify-center">
					<ListingCalendar
						availableDates={availableDates}
						numberOfMonths={1}
						onChange={setRange}
						value={range}
					/>
				</div>

				{tooShort && (
					<p className="text-amber-700 text-sm dark:text-amber-300">
						This home has a {minStay}-night minimum stay for those dates.
					</p>
				)}

				<DialogFooter>
					<Button onClick={() => onOpenChange(false)} variant="ghost">
						Cancel
					</Button>
					<Button
						disabled={!canSave || saving}
						onClick={() => {
							if (checkIn && checkOut) {
								onSave({ checkIn, checkOut });
							}
						}}
					>
						{saving ? "Updating" : "Save dates"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
