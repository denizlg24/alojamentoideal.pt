"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	NativeSelect,
	NativeSelectOption,
} from "@workspace/ui/components/native-select";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

interface ReservationActionsProps {
	bookingId: string;
	checkIn: string | null;
	checkOut: string | null;
	currentStatus: string;
	guests: number | null;
	reference: string;
}

const STATUS_TARGETS = [
	{ label: "Accepted", value: "accepted" },
	{ label: "Denied", value: "denied" },
	{ label: "Cancelled (by host)", value: "cancelled_by_host" },
	{ label: "Cancelled (by guest)", value: "cancelled_by_guest" },
	{ label: "No-show", value: "no_show" },
] as const;

function dateInputValue(value: string | null): string {
	return value ? value.slice(0, 10) : "";
}

/**
 * Per-reservation Hostify management: status transitions and date/guest-count
 * edits. Money-neutral — a cancellation here does not refund; the operator uses
 * the refund panel for that.
 */
export function ReservationActions({
	bookingId,
	checkIn,
	checkOut,
	currentStatus,
	guests,
	reference,
}: ReservationActionsProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [status, setStatus] = useState<string>("accepted");
	const [checkInValue, setCheckInValue] = useState(dateInputValue(checkIn));
	const [checkOutValue, setCheckOutValue] = useState(dateInputValue(checkOut));
	const [guestsValue, setGuestsValue] = useState(String(guests ?? ""));
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	const endpoint = `/api/admin/orders/${encodeURIComponent(reference)}/bookings/${encodeURIComponent(bookingId)}/reservation`;

	function send(body: Record<string, unknown>, successMessage: string) {
		startTransition(async () => {
			setError(null);
			const response = await fetch(endpoint, {
				body: JSON.stringify(body),
				headers: { "content-type": "application/json" },
				method: "PUT",
			});
			if (!response.ok) {
				const parsed = (await response.json().catch(() => null)) as {
					error?: string;
					issues?: { message: string }[];
				} | null;
				const issues = parsed?.issues?.map((issue) => issue.message).join(" ");
				setError(
					issues || parsed?.error || "Could not update the reservation.",
				);
				return;
			}
			toast.success(successMessage);
			setOpen(false);
			router.refresh();
		});
	}

	function saveDetails() {
		const body: Record<string, unknown> = {};
		if (checkInValue) {
			body.checkIn = checkInValue;
		}
		if (checkOutValue) {
			body.checkOut = checkOutValue;
		}
		const guestsNumber = Number(guestsValue);
		if (guestsValue && Number.isInteger(guestsNumber) && guestsNumber > 0) {
			body.guests = guestsNumber;
		}
		if (Object.keys(body).length === 0) {
			setError("Set a date or guest count to save.");
			return;
		}
		send(body, "Reservation updated.");
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setError(null);
				}
			}}
			open={open}
		>
			<DialogTrigger asChild>
				<Button size="sm" variant="ghost">
					Manage reservation
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Manage reservation</DialogTitle>
					<DialogDescription>
						Current status: {currentStatus}. Changes are applied to Hostify and
						synced locally. Refunds are handled separately.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6">
					<section className="space-y-2">
						<h3 className="font-medium text-sm">Status</h3>
						<div className="flex items-end gap-2">
							<div className="flex-1 space-y-1.5">
								<Label htmlFor="res-status">New status</Label>
								<NativeSelect
									id="res-status"
									onChange={(event) => setStatus(event.target.value)}
									value={status}
								>
									{STATUS_TARGETS.map((option) => (
										<NativeSelectOption key={option.value} value={option.value}>
											{option.label}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</div>
							<Button
								disabled={pending}
								onClick={() => send({ status }, "Reservation status updated.")}
								type="button"
							>
								Apply
							</Button>
						</div>
					</section>

					<section className="space-y-3">
						<h3 className="font-medium text-sm">Dates &amp; guests</h3>
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label htmlFor="res-checkin">Check-in</Label>
								<Input
									id="res-checkin"
									onChange={(event) => setCheckInValue(event.target.value)}
									type="date"
									value={checkInValue}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="res-checkout">Check-out</Label>
								<Input
									id="res-checkout"
									onChange={(event) => setCheckOutValue(event.target.value)}
									type="date"
									value={checkOutValue}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="res-guests">Guests</Label>
								<Input
									id="res-guests"
									inputMode="numeric"
									onChange={(event) => setGuestsValue(event.target.value)}
									value={guestsValue}
								/>
							</div>
						</div>
						<p className="text-muted-foreground text-xs">
							Guest-count and date changes are pushed to Hostify without
							re-pricing the reservation.
						</p>
						<Button disabled={pending} onClick={saveDetails} type="button">
							Save changes
						</Button>
					</section>

					{error ? <p className="text-destructive text-sm">{error}</p> : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
