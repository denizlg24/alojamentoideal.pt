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
import { ResponsiveSelect } from "@workspace/ui/components/responsive-select";
import { cn } from "@workspace/ui/lib/utils";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
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

const DOCUMENT_TYPE_OPTIONS = [
	{ label: "Select", value: "" },
	...DOCUMENT_TYPES.map((type) => ({ label: type, value: type })),
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
		residencyComplete(form)
	);
}

function residencyComplete(form: FormState): boolean {
	return (
		form.nationality.trim().length === 2 &&
		form.residenceCountry.trim().length === 2
	);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function StatusPill({ status }: { status: BookingGuestIdentityStatus }) {
	const pill = STATUS_PILL[status];
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full px-2.5 py-0.5 font-medium text-xs",
				pill.className,
			)}
		>
			{pill.label}
		</span>
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

function ReadRow({ label, value }: { label: string; value: string | null }) {
	return (
		<>
			<dt className="text-muted-foreground text-sm">{label}</dt>
			<dd className="text-sm">{value && value.length > 0 ? value : "—"}</dd>
		</>
	);
}

function ManualGuestForm({
	fieldId,
	form,
	update,
}: {
	fieldId: (name: string) => string;
	form: FormState;
	update: (key: keyof FormState, value: string) => void;
}) {
	return (
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
				<ResponsiveSelect
					className="w-full"
					id={fieldId("documentType")}
					onValueChange={(value) => update("documentType", value)}
					options={DOCUMENT_TYPE_OPTIONS}
					value={form.documentType}
				/>
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
					onChange={(event) => update("documentExpiresOn", event.target.value)}
					type="date"
					value={form.documentExpiresOn}
				/>
			</GuestField>
		</div>
	);
}

/**
 * A slot the current viewer fills themselves: either the owner registering a
 * still-unassigned guest, or a member on their own invited slot. Leads with
 * identity verification (reuse an account ID, or a fresh Stripe scan) and only
 * falls back to the full manual form when asked or when Stripe is unavailable.
 */
function EditableGuestCard({
	bookingId,
	canInvite,
	canReuseAccountIdentity,
	guest,
	heading,
	onRefresh,
	reference,
}: {
	bookingId: string;
	canInvite: boolean;
	canReuseAccountIdentity: boolean;
	guest: BookingGuestDetail;
	heading: string;
	onRefresh: () => Promise<void>;
	reference: string;
}) {
	const [form, setForm] = useState<FormState>(() => toFormState(guest.fields));
	const status = guest.identityStatus;
	const [manualOpen, setManualOpen] = useState(status === "provided");
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [inviteOpen, setInviteOpen] = useState(false);
	const [inviteEmail, setInviteEmail] = useState("");

	const [dirty, setDirty] = useState(false);

	// Keep the local form in sync when a refetch delivers new authoritative fields
	// (post-verification, account reuse). Refetches only follow the viewer's own
	// actions or the post-redirect poll, so this never clobbers a live edit.
	useEffect(() => {
		if (!dirty) {
			setForm(toFormState(guest.fields));
		}
	}, [guest.fields, dirty]);

	const fieldId = (name: string) => `guest-${guest.id}-${name}`;
	const update = (key: keyof FormState, value: string) => {
		setForm((current) => ({ ...current, [key]: value }));
		setSaved(false);
		setDirty(true);
	};

	async function handleManualSave(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!requiredComplete(form)) {
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await orderApi.updateBookingGuests(reference, bookingId, [
				{ fields: toPayload(form), id: guest.id },
			]);
			setSaved(true);
			setDirty(false);
			await onRefresh();
		} catch (caught) {
			setError(toCheckoutError(caught).message);
		} finally {
			setSaving(false);
		}
	}

	async function handleResidencySave(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!residencyComplete(form)) {
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await orderApi.saveGuestResidency(reference, bookingId, guest.id, {
				nationality: form.nationality,
				residenceCountry: form.residenceCountry,
			});
			setSaved(true);
			setDirty(false);
			await onRefresh();
		} catch (caught) {
			setError(toCheckoutError(caught).message);
		} finally {
			setSaving(false);
		}
	}

	async function reuseAccountIdentity() {
		setError(null);
		setBusy(true);
		try {
			await orderApi.applyAccountIdentityToGuest(
				reference,
				bookingId,
				guest.id,
			);
			await onRefresh();
		} catch (caught) {
			setError(toCheckoutError(caught).message);
		} finally {
			setBusy(false);
		}
	}

	async function startVerification() {
		setError(null);
		setBusy(true);
		try {
			const session = await orderApi.createGuestIdentitySession(
				reference,
				bookingId,
				guest.id,
			);
			const stripe = session.clientSecret ? await getStripe() : null;
			if (!session.clientSecret || !stripe) {
				setError("Identity verification isn't available right now.");
				return;
			}
			const result = await stripe.verifyIdentity(session.clientSecret);
			if (result.error) {
				setError(result.error.message ?? "Verification was not completed.");
				return;
			}
			// Submitted; Stripe processes asynchronously and the webhook records the
			// final status and fields. Poll a few times to reflect the outcome.
			await pollUntilSettled(onRefresh);
		} catch (caught) {
			setError(toCheckoutError(caught).message);
		} finally {
			setBusy(false);
		}
	}

	async function sendInvite(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const email = inviteEmail.trim();
		if (!EMAIL_PATTERN.test(email)) {
			setError("Enter a valid email address.");
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await orderApi.inviteGuest(reference, bookingId, guest.id, email);
			setInviteEmail("");
			setInviteOpen(false);
			await onRefresh();
		} catch (caught) {
			setError(toCheckoutError(caught).message);
		} finally {
			setBusy(false);
		}
	}

	const configured = isStripeConfigured();
	const verified = status === "verified";
	const processing = status === "processing";
	// Toggle the residency read-only view on the *saved* server value, not the
	// live form, so completing the inputs doesn't collapse the form before the
	// save round-trip lands (which would flash the not-yet-persisted blanks).
	const residencySaved =
		(guest.fields.nationality ?? "").trim().length === 2 &&
		(guest.fields.residenceCountry ?? "").trim().length === 2;
	const verifyLabel =
		status === "requires_input" || status === "canceled"
			? "Try again"
			: "Verify identity";

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-border/60 p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-medium text-sm">{heading}</h3>
				<StatusPill status={status} />
			</div>

			{processing ? (
				<p className="text-muted-foreground text-sm leading-relaxed">
					We're reviewing this document. This page updates once the check
					completes.
				</p>
			) : verified ? (
				<div className="flex flex-col gap-4">
					<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
						<ReadRow
							label="Name"
							value={`${guest.fields.firstName ?? ""} ${
								guest.fields.lastName ?? ""
							}`.trim()}
						/>
						<ReadRow label="Date of birth" value={guest.fields.dateOfBirth} />
						<ReadRow label="Document" value={guest.fields.documentType} />
					</dl>
					{residencySaved ? (
						<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
							<ReadRow label="Nationality" value={guest.fields.nationality} />
							<ReadRow
								label="Country of residence"
								value={guest.fields.residenceCountry}
							/>
						</dl>
					) : (
						<form
							className="flex flex-col gap-3"
							onSubmit={handleResidencySave}
						>
							<p className="text-muted-foreground text-sm">
								Identity verified. Confirm two details we still need for
								registration.
							</p>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
											update(
												"residenceCountry",
												event.target.value.toUpperCase(),
											)
										}
										placeholder="PT"
										value={form.residenceCountry}
									/>
								</GuestField>
							</div>
							<div>
								<Button
									disabled={!residencyComplete(form) || saving}
									size="sm"
									type="submit"
								>
									{saving ? "Saving…" : "Save details"}
								</Button>
							</div>
						</form>
					)}
				</div>
			) : (
				<div className="flex flex-col gap-4">
					{!manualOpen && (
						<>
							<p className="text-muted-foreground text-sm leading-relaxed">
								Verify identity to fill in the details automatically. You'll
								need a government ID and your device camera.
							</p>
							<div className="flex flex-wrap items-center gap-2">
								{canReuseAccountIdentity && (
									<Button
										disabled={busy}
										onClick={reuseAccountIdentity}
										size="sm"
										type="button"
									>
										{busy ? "Applying…" : "Use my verified ID"}
									</Button>
								)}
								{configured && (
									<Button
										disabled={busy}
										onClick={startVerification}
										size="sm"
										type="button"
										variant={canReuseAccountIdentity ? "outline" : "default"}
									>
										{busy ? "Starting…" : verifyLabel}
									</Button>
								)}
								<Button
									onClick={() => setManualOpen(true)}
									size="sm"
									type="button"
									variant="ghost"
								>
									Enter details manually
								</Button>
							</div>
						</>
					)}
					{manualOpen && (
						<form className="flex flex-col gap-4" onSubmit={handleManualSave}>
							<ManualGuestForm fieldId={fieldId} form={form} update={update} />
							<div className="flex flex-wrap items-center gap-2">
								<Button
									disabled={!requiredComplete(form) || saving}
									size="sm"
									type="submit"
								>
									{saving ? "Saving…" : "Save details"}
								</Button>
								{configured && (
									<Button
										disabled={busy}
										onClick={startVerification}
										size="sm"
										type="button"
										variant="outline"
									>
										{busy ? "Starting…" : "Verify instead"}
									</Button>
								)}
								{saved && !saving && (
									<span className="text-emerald-700 text-sm">Saved</span>
								)}
							</div>
						</form>
					)}
				</div>
			)}

			{error && <p className="text-destructive text-sm">{error}</p>}

			{canInvite && (
				<div className="border-border/60 border-t pt-3">
					{inviteOpen ? (
						<form className="flex flex-col gap-2" onSubmit={sendInvite}>
							<Label htmlFor={fieldId("invite")}>
								Invite this guest to fill their own details
							</Label>
							<div className="flex flex-wrap items-center gap-2">
								<Input
									className="max-w-xs"
									id={fieldId("invite")}
									onChange={(event) => setInviteEmail(event.target.value)}
									placeholder="guest@email.com"
									type="email"
									value={inviteEmail}
								/>
								<Button disabled={busy} size="sm" type="submit">
									{busy ? "Sending…" : "Send invite"}
								</Button>
								<Button
									onClick={() => setInviteOpen(false)}
									size="sm"
									type="button"
									variant="ghost"
								>
									Cancel
								</Button>
							</div>
						</form>
					) : (
						<Button
							onClick={() => setInviteOpen(true)}
							size="sm"
							type="button"
							variant="ghost"
						>
							Or invite this guest to fill their own details
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * Owner's read-only view of a slot handed to someone else. An invited slot shows
 * the pending recipient with resend/cancel; a filled (active) slot shows the
 * guest's own registration status with an option to remove them and reclaim it.
 */
function AssignedSlotCard({
	guest,
	heading,
	onRefresh,
	reference,
}: {
	guest: BookingGuestDetail;
	heading: string;
	onRefresh: () => Promise<void>;
	reference: string;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const assignment = guest.assignment;
	if (assignment.kind !== "member") {
		return null;
	}
	const invited = assignment.status === "invited";
	const expired =
		invited &&
		assignment.expiresAt !== null &&
		new Date(assignment.expiresAt).getTime() <= Date.now();

	async function run(action: () => Promise<unknown>) {
		setBusy(true);
		setError(null);
		try {
			await action();
			await onRefresh();
		} catch (caught) {
			setError(toCheckoutError(caught).message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-border/60 p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-medium text-sm">{heading}</h3>
				<StatusPill status={guest.identityStatus} />
			</div>
			<p className="text-muted-foreground text-sm">
				{invited
					? `Invited ${assignment.email}${expired ? " · invite expired" : " · awaiting them"}`
					: `Handled by ${assignment.email}`}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				{invited && (
					<Button
						disabled={busy}
						onClick={() =>
							run(() =>
								orderApi.resendOrderMemberInvite(
									reference,
									assignment.memberId,
								),
							)
						}
						size="sm"
						type="button"
						variant="outline"
					>
						{busy ? "Working…" : "Resend invite"}
					</Button>
				)}
				<Button
					disabled={busy}
					onClick={() =>
						run(() =>
							orderApi.revokeOrderMember(reference, assignment.memberId),
						)
					}
					size="sm"
					type="button"
					variant="ghost"
				>
					{invited ? "Cancel invite" : "Remove guest"}
				</Button>
			</div>
			{error && <p className="text-destructive text-sm">{error}</p>}
		</div>
	);
}

const IDENTITY_RETURN_POLLS = 6;
const IDENTITY_RETURN_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function pollUntilSettled(
	refresh: () => Promise<void>,
	isSettled?: () => boolean,
): Promise<void> {
	for (let attempt = 0; attempt < IDENTITY_RETURN_POLLS; attempt += 1) {
		if (attempt > 0) {
			await sleep(IDENTITY_RETURN_DELAY_MS);
		}
		await refresh();
		if (isSettled?.()) {
			return;
		}
	}
}

export function OrderGuests({
	bookings: initialBookings,
	canReuseAccountIdentity,
	reference,
	role,
}: {
	bookings: GuestBookingView[];
	canReuseAccountIdentity: boolean;
	reference: string;
	role: OrderRole;
}) {
	const [bookings, setBookings] = useState<GuestBookingView[]>(initialBookings);
	const bookingsRef = useRef(bookings);
	bookingsRef.current = bookings;

	const refresh = useCallback(async () => {
		const refreshed = await Promise.all(
			bookingsRef.current.map(async (booking) => {
				if (booking.unavailable) {
					return booking;
				}
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
		setBookings(refreshed);
	}, [reference]);

	// After a hosted Stripe Identity redirect (?identity=complete), the webhook
	// records the final status asynchronously, so poll a few times to refresh.
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.get("identity") !== "complete") {
			return;
		}
		void pollUntilSettled(refresh);
	}, [refresh]);

	const multiBooking = bookings.length > 1;

	return (
		<div className="flex flex-col gap-8">
			<div className="flex flex-col gap-1">
				<h2 className="font-heading font-medium text-base">
					Guest registration
				</h2>
				<p className="text-muted-foreground text-sm leading-relaxed">
					{role === "owner"
						? "Register each guest, or invite them to fill their own details. Northern Portugal requires guest registration for every stay; verifying identity speeds up check-in."
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
						booking.guests.map((guest, index) => {
							const heading =
								role === "owner" ? `Guest ${index + 1}` : "Your details";
							const isAssignedToOther =
								role === "owner" && guest.assignment.kind === "member";
							return isAssignedToOther ? (
								<AssignedSlotCard
									guest={guest}
									heading={heading}
									key={guest.id}
									onRefresh={refresh}
									reference={reference}
								/>
							) : (
								<EditableGuestCard
									bookingId={booking.bookingId}
									canInvite={role === "owner"}
									canReuseAccountIdentity={canReuseAccountIdentity}
									guest={guest}
									heading={heading}
									key={guest.id}
									onRefresh={refresh}
									reference={reference}
								/>
							);
						})
					)}
				</section>
			))}
		</div>
	);
}
