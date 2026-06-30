"use client";

import type {
	BookingGuestDetail,
	BookingGuestIdentityFields,
	OrderRole,
} from "@workspace/core/commerce";
import type { BookingGuestIdentityStatus } from "@workspace/db";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	NativeSelect,
	NativeSelectOption,
} from "@workspace/ui/components/native-select";
import { cn } from "@workspace/ui/lib/utils";
import { type FormEvent, useEffect, useState } from "react";
import { toCheckoutError } from "@/lib/checkout/errors";
import { getStripe, isStripeConfigured } from "@/lib/checkout/stripe";
import * as orderApi from "@/lib/order/api-client";

export interface GuestBookingView {
	bookingId: string;
	guests: BookingGuestDetail[];
	title: string;
	unavailable: boolean;
}

const STATUS_PILL: Record<
	BookingGuestIdentityStatus,
	{ className: string; label: string }
> = {
	canceled: {
		className: "bg-muted text-muted-foreground",
		label: "Not verified",
	},
	missing: {
		className: "bg-muted text-muted-foreground",
		label: "Not started",
	},
	processing: { className: "bg-amber-100 text-amber-800", label: "In review" },
	provided: { className: "bg-sky-100 text-sky-800", label: "Details added" },
	requires_input: {
		className: "bg-amber-100 text-amber-800",
		label: "Action needed",
	},
	verified: { className: "bg-emerald-100 text-emerald-800", label: "Verified" },
};

const DOCUMENT_TYPES = [
	"Passport",
	"National ID",
	"Driving licence",
	"Residence permit",
	"Other",
];

type FormState = Record<keyof BookingGuestIdentityFields, string>;

function toFormState(fields: BookingGuestIdentityFields): FormState {
	return {
		dateOfBirth: fields.dateOfBirth ?? "",
		documentExpiresOn: fields.documentExpiresOn ?? "",
		documentIssuingCountry: fields.documentIssuingCountry ?? "",
		documentNumber: fields.documentNumber ?? "",
		documentType: fields.documentType ?? "",
		firstName: fields.firstName ?? "",
		lastName: fields.lastName ?? "",
		nationality: fields.nationality ?? "",
		residenceCountry: fields.residenceCountry ?? "",
	};
}

function toPayload(form: FormState): BookingGuestIdentityFields {
	const optional = (value: string) => {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	};
	const country = (value: string) => {
		const trimmed = value.trim().toUpperCase();
		return trimmed.length > 0 ? trimmed : null;
	};
	return {
		dateOfBirth: form.dateOfBirth || null,
		documentExpiresOn: form.documentExpiresOn || null,
		documentIssuingCountry: country(form.documentIssuingCountry),
		documentNumber: optional(form.documentNumber),
		documentType: optional(form.documentType),
		firstName: form.firstName.trim(),
		lastName: form.lastName.trim(),
		nationality: form.nationality.trim().toUpperCase(),
		residenceCountry: form.residenceCountry.trim().toUpperCase(),
	};
}

function requiredComplete(form: FormState): boolean {
	return (
		form.firstName.trim().length > 0 &&
		form.lastName.trim().length > 0 &&
		form.dateOfBirth.length > 0 &&
		form.nationality.trim().length === 2 &&
		form.residenceCountry.trim().length === 2
	);
}

function GuestField({
	children,
	htmlFor,
	label,
}: {
	children: React.ReactNode;
	htmlFor: string;
	label: string;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
		</div>
	);
}

function GuestCard({
	bookingId,
	guest,
	heading,
	reference,
}: {
	bookingId: string;
	guest: BookingGuestDetail;
	heading: string;
	reference: string;
}) {
	const [form, setForm] = useState<FormState>(() => toFormState(guest.fields));
	const [status, setStatus] = useState<BookingGuestIdentityStatus>(
		guest.identityStatus,
	);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [verifying, setVerifying] = useState(false);
	const [identityError, setIdentityError] = useState<string | null>(null);

	// Reflect status changes that arrive from the parent (a post-verification
	// refetch) without clobbering fields the guest may still be editing.
	useEffect(() => {
		setStatus(guest.identityStatus);
	}, [guest.identityStatus]);

	const fieldId = (name: string) => `guest-${guest.id}-${name}`;
	const update = (key: keyof FormState, value: string) => {
		setForm((current) => ({ ...current, [key]: value }));
		setSaved(false);
	};

	async function handleSave(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!requiredComplete(form)) {
			return;
		}
		setSaving(true);
		setSaveError(null);
		try {
			const result = await orderApi.updateBookingGuests(reference, bookingId, [
				{ fields: toPayload(form), id: guest.id },
			]);
			const updated =
				result.guests.find((entry) => entry.id === guest.id) ??
				result.guests[0];
			if (updated) {
				setForm(toFormState(updated.fields));
				setStatus(updated.identityStatus);
			}
			setSaved(true);
		} catch (caught) {
			setSaveError(toCheckoutError(caught).message);
		} finally {
			setSaving(false);
		}
	}

	async function startVerification() {
		setIdentityError(null);
		setVerifying(true);
		try {
			const session = await orderApi.createGuestIdentitySession(
				reference,
				bookingId,
				guest.id,
			);
			if (!session.clientSecret) {
				setIdentityError("Identity verification isn't available right now.");
				return;
			}
			const stripe = await getStripe();
			if (!stripe) {
				setIdentityError("Identity verification isn't available right now.");
				return;
			}
			const result = await stripe.verifyIdentity(session.clientSecret);
			if (result.error) {
				setIdentityError(
					result.error.message ?? "Verification was not completed.",
				);
				return;
			}
			// Submitted; Stripe processes asynchronously and the webhook records the
			// final status. Reflect "in review" immediately.
			setStatus("processing");
		} catch (caught) {
			setIdentityError(toCheckoutError(caught).message);
		} finally {
			setVerifying(false);
		}
	}

	const pill = STATUS_PILL[status];
	const showVerify =
		status !== "verified" && status !== "processing" && isStripeConfigured();
	const verifyLabel =
		status === "requires_input" || status === "canceled"
			? "Try again"
			: "Verify identity";
	const canSave = requiredComplete(form) && !saving;

	return (
		<form className="flex flex-col gap-4" onSubmit={handleSave}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-medium text-sm">{heading}</h3>
				<span
					className={cn(
						"inline-flex items-center rounded-full px-2.5 py-0.5 font-medium text-xs",
						pill.className,
					)}
				>
					{pill.label}
				</span>
			</div>

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<GuestField htmlFor={fieldId("firstName")} label="First name">
					<Input
						autoComplete="given-name"
						id={fieldId("firstName")}
						onChange={(event) => update("firstName", event.target.value)}
						value={form.firstName}
					/>
				</GuestField>
				<GuestField htmlFor={fieldId("lastName")} label="Last name">
					<Input
						autoComplete="family-name"
						id={fieldId("lastName")}
						onChange={(event) => update("lastName", event.target.value)}
						value={form.lastName}
					/>
				</GuestField>
				<GuestField htmlFor={fieldId("dateOfBirth")} label="Date of birth">
					<Input
						id={fieldId("dateOfBirth")}
						onChange={(event) => update("dateOfBirth", event.target.value)}
						type="date"
						value={form.dateOfBirth}
					/>
				</GuestField>
				<GuestField
					htmlFor={fieldId("nationality")}
					label="Nationality (2-letter)"
				>
					<Input
						id={fieldId("nationality")}
						maxLength={2}
						onChange={(event) =>
							update("nationality", event.target.value.toUpperCase())
						}
						placeholder="PT"
						value={form.nationality}
					/>
				</GuestField>
				<GuestField
					htmlFor={fieldId("residenceCountry")}
					label="Country of residence (2-letter)"
				>
					<Input
						id={fieldId("residenceCountry")}
						maxLength={2}
						onChange={(event) =>
							update("residenceCountry", event.target.value.toUpperCase())
						}
						placeholder="PT"
						value={form.residenceCountry}
					/>
				</GuestField>
				<GuestField htmlFor={fieldId("documentType")} label="Document type">
					<NativeSelect
						className="w-full"
						id={fieldId("documentType")}
						onChange={(event) => update("documentType", event.target.value)}
						value={form.documentType}
					>
						<NativeSelectOption value="">Select</NativeSelectOption>
						{DOCUMENT_TYPES.map((type) => (
							<NativeSelectOption key={type} value={type}>
								{type}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</GuestField>
				<GuestField htmlFor={fieldId("documentNumber")} label="Document number">
					<Input
						id={fieldId("documentNumber")}
						onChange={(event) => update("documentNumber", event.target.value)}
						value={form.documentNumber}
					/>
				</GuestField>
				<GuestField
					htmlFor={fieldId("documentIssuingCountry")}
					label="Issuing country (2-letter)"
				>
					<Input
						id={fieldId("documentIssuingCountry")}
						maxLength={2}
						onChange={(event) =>
							update("documentIssuingCountry", event.target.value.toUpperCase())
						}
						placeholder="PT"
						value={form.documentIssuingCountry}
					/>
				</GuestField>
				<GuestField
					htmlFor={fieldId("documentExpiresOn")}
					label="Document expiry"
				>
					<Input
						id={fieldId("documentExpiresOn")}
						onChange={(event) =>
							update("documentExpiresOn", event.target.value)
						}
						type="date"
						value={form.documentExpiresOn}
					/>
				</GuestField>
			</div>

			{saveError && <p className="text-destructive text-sm">{saveError}</p>}
			{identityError && (
				<p className="text-destructive text-sm">{identityError}</p>
			)}

			<div className="flex flex-wrap items-center gap-2">
				<Button disabled={!canSave} size="sm" type="submit">
					{saving ? "Saving…" : "Save details"}
				</Button>
				{showVerify && (
					<Button
						disabled={verifying}
						onClick={startVerification}
						size="sm"
						type="button"
						variant="outline"
					>
						{verifying ? "Starting…" : verifyLabel}
					</Button>
				)}
				{saved && !saving && (
					<span className="text-emerald-700 text-sm">Saved</span>
				)}
			</div>
		</form>
	);
}

const IDENTITY_RETURN_POLLS = 6;
const IDENTITY_RETURN_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function OrderGuests({
	bookings: initialBookings,
	reference,
	role,
}: {
	bookings: GuestBookingView[];
	reference: string;
	role: OrderRole;
}) {
	const [bookings, setBookings] = useState<GuestBookingView[]>(initialBookings);

	// After a hosted Stripe Identity redirect (?identity=complete), the webhook
	// records the final status asynchronously, so poll a few times to refresh.
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.get("identity") !== "complete") {
			return;
		}
		let cancelled = false;
		void (async () => {
			for (let attempt = 0; attempt < IDENTITY_RETURN_POLLS; attempt += 1) {
				if (attempt > 0) {
					await sleep(IDENTITY_RETURN_DELAY_MS);
				}
				const refreshed = await Promise.all(
					initialBookings.map(async (booking) => {
						try {
							const list = await orderApi.getBookingGuests(
								reference,
								booking.bookingId,
							);
							return { ...booking, guests: list.guests };
						} catch {
							return booking;
						}
					}),
				);
				if (cancelled) {
					return;
				}
				setBookings(refreshed);
				const settled = refreshed.some((booking) =>
					booking.guests.some(
						(guest) =>
							guest.identityStatus === "verified" ||
							guest.identityStatus === "requires_input" ||
							guest.identityStatus === "canceled",
					),
				);
				if (settled) {
					return;
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [initialBookings, reference]);

	const multiBooking = bookings.length > 1;

	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-col gap-1">
				<h2 className="font-heading font-medium text-base">
					Guest registration
				</h2>
				<p className="text-muted-foreground text-sm leading-relaxed">
					{role === "owner"
						? "Add each guest's details. Northern Portugal requires guest registration for every stay; verifying identity speeds up check-in."
						: "Add your details for this stay. Northern Portugal requires guest registration; verifying your identity speeds up check-in."}
				</p>
			</div>

			{bookings.length === 0 && (
				<p className="text-muted-foreground text-sm">
					This booking does not need guest registration.
				</p>
			)}

			{bookings.map((booking) => (
				<section className="flex flex-col gap-6" key={booking.bookingId}>
					{multiBooking && (
						<h3 className="font-heading font-medium text-sm">
							{booking.title}
						</h3>
					)}
					{booking.unavailable ? (
						<p className="text-muted-foreground text-sm">
							No guest slot is available for you on this booking yet.
						</p>
					) : (
						booking.guests.map((guest, index) => (
							<GuestCard
								bookingId={booking.bookingId}
								guest={guest}
								heading={
									role === "owner" ? `Guest ${index + 1}` : "Your details"
								}
								key={guest.id}
								reference={reference}
							/>
						))
					)}
				</section>
			))}
		</div>
	);
}
