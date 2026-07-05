"use client";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@workspace/ui/components/accordion";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { ListingCalendar } from "@/components/listings/detail/listing-calendar";
import { useBookingAvailability } from "@/components/listings/detail/use-booking-availability";
import { GuestFields } from "@/components/search/guest-selector";
import { nightsBetween, parseIsoDate, toIsoDate } from "@/lib/catalog/dates";
import { capacityForGuests } from "@/lib/catalog/guests";
import { formatStayRangeLong, guestSummaryLabel } from "@/lib/checkout/format";
import type {
	EditStayValue,
	GuestSelection,
} from "./use-optimistic-stay-edits";

interface EditStayDialogProps {
	listingId: string;
	maxGuests: number | null;
	minNights: number;
	onOpenChange: (open: boolean) => void;
	onSave: (next: EditStayValue) => void;
	open: boolean;
	value: EditStayValue;
}

/**
 * Combined stay editor: one dialog with collapsible Dates and Guests sections,
 * mirroring the mobile filters sheet. Both are edited as a draft and committed
 * together by the Save button; closing without saving discards the draft. The
 * dialog is full-screen on mobile.
 */
export function EditStayDialog({
	listingId,
	maxGuests,
	minNights,
	onOpenChange,
	onSave,
	open,
	value,
}: EditStayDialogProps) {
	const availabilityState = useBookingAvailability(listingId, minNights);
	const availability =
		availabilityState.status === "ready"
			? availabilityState.availability
			: null;
	const availableDates = availability?.availableDates ?? null;

	const [range, setRange] = useState<DateRange | undefined>(() => ({
		from: parseIsoDate(value.checkIn),
		to: parseIsoDate(value.checkOut),
	}));
	const [guests, setGuests] = useState<GuestSelection>({
		adults: value.adults,
		children: value.children,
		infants: value.infants,
	});

	// Reseed the drafts from the committed stay only when the dialog opens, not on
	// every `value` change: an optimistic reconcile landing while open must not
	// snap the calendar or steppers back under the guest.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reseed on the open edge only; the latest value is read intentionally.
	useEffect(() => {
		if (open) {
			setRange({
				from: parseIsoDate(value.checkIn),
				to: parseIsoDate(value.checkOut),
			});
			setGuests({
				adults: value.adults,
				children: value.children,
				infants: value.infants,
			});
		}
	}, [open]);

	const checkIn = range?.from ? toIsoDate(range.from) : null;
	const checkOut = range?.to ? toIsoDate(range.to) : null;
	const minStay = checkIn
		? (availability?.minStayByDate[checkIn] ?? minNights)
		: minNights;
	const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
	const tooShort = Boolean(checkIn && checkOut && nights < minStay);

	const capacity = capacityForGuests(guests.adults, guests.children);
	const overCapacity = maxGuests !== null && capacity > maxGuests;

	const datesLabel =
		checkIn && checkOut
			? formatStayRangeLong(checkIn, checkOut)
			: "Select dates";
	const guestsLabel = guestSummaryLabel({
		adults: guests.adults,
		children: guests.children,
		infants: guests.infants,
	});

	const canSave = Boolean(checkIn && checkOut) && !tooShort && !overCapacity;
	const changed =
		checkIn !== value.checkIn ||
		checkOut !== value.checkOut ||
		guests.adults !== value.adults ||
		guests.children !== value.children ||
		guests.infants !== value.infants;

	const handleSave = () => {
		if (!checkIn || !checkOut || !canSave) {
			return;
		}
		if (changed) {
			onSave({ ...guests, checkIn, checkOut });
		}
		onOpenChange(false);
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent
				className="flex max-h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-md"
				showCloseButton={false}
			>
				<DialogHeader className="relative flex-row items-center justify-center border-b px-12 py-4">
					<DialogClose asChild>
						<Button className="absolute left-3" size="icon-sm" variant="ghost">
							<X className="size-4" />
							<span className="sr-only">Close</span>
						</Button>
					</DialogClose>
					<DialogTitle>Edit your stay</DialogTitle>
					<DialogDescription className="sr-only">
						Change the dates or guests for this stay.
					</DialogDescription>
				</DialogHeader>

				<div className="flex-1 overflow-y-auto px-6 py-2">
					<Accordion collapsible defaultValue="dates" type="single">
						<AccordionItem value="dates">
							<AccordionTrigger>
								<span className="flex flex-col gap-0.5 text-left">
									<span className="font-heading text-base">Dates</span>
									<span className="font-normal text-muted-foreground text-xs">
										{datesLabel}
									</span>
								</span>
							</AccordionTrigger>
							<AccordionContent className="h-auto">
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
										This home has a {minStay}-night minimum stay for those
										dates.
									</p>
								)}
							</AccordionContent>
						</AccordionItem>
						<AccordionItem value="guests">
							<AccordionTrigger>
								<span className="flex flex-col gap-0.5 text-left">
									<span className="font-heading text-base">Guests</span>
									<span className="font-normal text-muted-foreground text-xs">
										{guestsLabel}
									</span>
								</span>
							</AccordionTrigger>
							<AccordionContent>
								<GuestFields onChange={setGuests} value={guests} />
								{maxGuests !== null && (
									<p className="mt-2 text-muted-foreground text-xs">
										This home sleeps up to {maxGuests}.
									</p>
								)}
								{overCapacity && (
									<p className="mt-1 text-destructive text-sm">
										That is more than this home can host. Reduce the number of
										guests to save.
									</p>
								)}
							</AccordionContent>
						</AccordionItem>
					</Accordion>
				</div>

				<DialogFooter className="flex-row items-center justify-between border-t px-6 py-4">
					<Button
						onClick={() => onOpenChange(false)}
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button disabled={!canSave} onClick={handleSave} type="button">
						Save changes
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
