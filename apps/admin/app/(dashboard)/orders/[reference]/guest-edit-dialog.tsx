"use client";

import type { BookingGuestDetail } from "@workspace/core/commerce";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
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
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

interface GuestEditDialogProps {
	bookingId: string;
	guest: BookingGuestDetail;
	reference: string;
}

const DOCUMENT_TYPES = [
	{ label: "None", value: "" },
	{ label: "Passport", value: "passport" },
	{ label: "ID card", value: "id_card" },
	{ label: "Other", value: "other" },
] as const;

function fieldValue(form: FormData, name: string): string | null {
	const raw = String(form.get(name) ?? "").trim();
	return raw ? raw : null;
}

/**
 * Operator edit of one guest's identity record. Saving re-encrypts the
 * fields and, when the booking's Hostkit submission had already succeeded,
 * automatically queues a fresh submission.
 */
export function GuestEditDialog({
	bookingId,
	guest,
	reference,
}: GuestEditDialogProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const fields = {
			dateOfBirth: fieldValue(form, "dateOfBirth"),
			documentExpiresOn: fieldValue(form, "documentExpiresOn"),
			documentIssuingCountry: fieldValue(form, "documentIssuingCountry"),
			documentNumber: fieldValue(form, "documentNumber"),
			documentType: fieldValue(form, "documentType"),
			firstName: fieldValue(form, "firstName"),
			lastName: fieldValue(form, "lastName"),
			nationality: fieldValue(form, "nationality"),
			residenceCountry: fieldValue(form, "residenceCountry"),
		};

		startTransition(async () => {
			setError(null);
			const response = await fetch(
				`/api/admin/orders/${encodeURIComponent(reference)}/bookings/${encodeURIComponent(bookingId)}/guests`,
				{
					body: JSON.stringify({ guests: [{ fields, id: guest.id }] }),
					headers: { "content-type": "application/json" },
					method: "PUT",
				},
			);
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as {
					error?: string;
					issues?: { message: string; path: string }[];
				} | null;
				const issues = body?.issues?.map((issue) => issue.message).join(" ");
				setError(issues || body?.error || "Could not save guest details.");
				return;
			}
			toast.success("Guest details saved. Compliance resubmission queued.");
			setOpen(false);
			router.refresh();
		});
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
					Edit
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Guest {guest.position + 1}</DialogTitle>
					<DialogDescription>
						Legal registration record for this stay. Country fields take ISO
						3166-1 alpha-2 codes (PT, ES, ...).
					</DialogDescription>
				</DialogHeader>
				<form className="space-y-4" onSubmit={handleSubmit}>
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<Label htmlFor={`first-${guest.id}`}>First name</Label>
							<Input
								defaultValue={guest.fields.firstName ?? ""}
								id={`first-${guest.id}`}
								name="firstName"
								required
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor={`last-${guest.id}`}>Last name</Label>
							<Input
								defaultValue={guest.fields.lastName ?? ""}
								id={`last-${guest.id}`}
								name="lastName"
								required
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor={`dob-${guest.id}`}>Date of birth</Label>
							<Input
								defaultValue={guest.fields.dateOfBirth ?? ""}
								id={`dob-${guest.id}`}
								name="dateOfBirth"
								required
								type="date"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor={`nationality-${guest.id}`}>Nationality</Label>
							<Input
								defaultValue={guest.fields.nationality ?? ""}
								id={`nationality-${guest.id}`}
								maxLength={2}
								name="nationality"
								placeholder="PT"
								required
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor={`residence-${guest.id}`}>Residence country</Label>
							<Input
								defaultValue={guest.fields.residenceCountry ?? ""}
								id={`residence-${guest.id}`}
								maxLength={2}
								name="residenceCountry"
								placeholder="PT"
								required
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor={`doctype-${guest.id}`}>Document type</Label>
							<NativeSelect
								defaultValue={guest.fields.documentType ?? ""}
								id={`doctype-${guest.id}`}
								name="documentType"
							>
								{DOCUMENT_TYPES.map((option) => (
									<NativeSelectOption key={option.value} value={option.value}>
										{option.label}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor={`docnum-${guest.id}`}>Document number</Label>
							<Input
								defaultValue={guest.fields.documentNumber ?? ""}
								id={`docnum-${guest.id}`}
								name="documentNumber"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor={`doccountry-${guest.id}`}>
								Document issuing country
							</Label>
							<Input
								defaultValue={guest.fields.documentIssuingCountry ?? ""}
								id={`doccountry-${guest.id}`}
								maxLength={2}
								name="documentIssuingCountry"
								placeholder="PT"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor={`docexp-${guest.id}`}>Document expiry</Label>
							<Input
								defaultValue={guest.fields.documentExpiresOn ?? ""}
								id={`docexp-${guest.id}`}
								name="documentExpiresOn"
								type="date"
							/>
						</div>
					</div>
					<p className="text-muted-foreground text-xs">
						Document type, number and issuing country must be provided together
						or left empty together.
					</p>
					{error ? <p className="text-destructive text-sm">{error}</p> : null}
					<DialogFooter>
						<Button
							onClick={() => setOpen(false)}
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button disabled={pending} type="submit">
							{pending ? "Saving…" : "Save guest"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
