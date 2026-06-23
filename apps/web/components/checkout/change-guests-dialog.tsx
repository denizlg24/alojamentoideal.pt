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
import { GuestFields } from "@/components/search/guest-selector";
import { capacityForGuests } from "@/lib/catalog/guests";

export interface GuestSelection {
	adults: number;
	children: number;
	infants: number;
}

interface ChangeGuestsDialogProps {
	maxGuests: number | null;
	onOpenChange: (open: boolean) => void;
	onSave: (next: GuestSelection) => void;
	open: boolean;
	saving: boolean;
	value: GuestSelection;
}

/**
 * Guest editor honoring the booking widget's semantics: adults+children count
 * toward capacity, infants do not. Pets are not offered here (only listings
 * that support them, handled elsewhere).
 */
export function ChangeGuestsDialog({
	maxGuests,
	onOpenChange,
	onSave,
	open,
	saving,
	value,
}: ChangeGuestsDialogProps) {
	const [draft, setDraft] = useState<GuestSelection>(value);

	// Reset the draft to the committed value whenever the dialog reopens.
	useEffect(() => {
		if (open) {
			setDraft(value);
		}
	}, [open, value]);

	const capacity = capacityForGuests(draft.adults, draft.children);
	const overCapacity = maxGuests !== null && capacity > maxGuests;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="rounded-2xl">
				<DialogHeader>
					<DialogTitle>Guests</DialogTitle>
					{maxGuests !== null && (
						<DialogDescription>
							This home has a maximum of {maxGuests}{" "}
							{maxGuests === 1 ? "guest" : "guests"}.
						</DialogDescription>
					)}
				</DialogHeader>

				<GuestFields onChange={setDraft} value={draft} />

				{overCapacity && (
					<p className="text-destructive text-sm">
						That is more than this home can host. Please reduce the number of
						guests.
					</p>
				)}

				<DialogFooter>
					<Button onClick={() => onOpenChange(false)} variant="ghost">
						Cancel
					</Button>
					<Button
						disabled={overCapacity || saving}
						onClick={() => onSave(draft)}
					>
						{saving ? "Saving" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
