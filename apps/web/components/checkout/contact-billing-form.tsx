"use client";

import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import { useState } from "react";
import { CheckoutAlert } from "./checkout-alert";
import type { ContactDraft } from "./types";

interface ContactBillingFormProps {
	error: string | null;
	/** Optional secondary action; shown when editing already-saved contact. */
	onCancel?: () => void;
	onChange: (next: ContactDraft) => void;
	onSubmit: () => void;
	prefilledFromAccount: boolean;
	submitLabel?: string;
	submitting: boolean;
	value: ContactDraft;
}

function isContactComplete(value: ContactDraft): boolean {
	return (
		value.name.trim().length > 0 &&
		/.+@.+\..+/.test(value.email.trim()) &&
		value.phone.trim().length >= 3
	);
}

interface FieldProps {
	autoComplete?: string;
	id: string;
	label: string;
	onChange: (value: string) => void;
	placeholder?: string;
	type?: string;
	value: string;
}

function Field({
	autoComplete,
	id,
	label,
	onChange,
	placeholder,
	type = "text",
	value,
}: FieldProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Input
				autoComplete={autoComplete}
				id={id}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				type={type}
				value={value}
			/>
		</div>
	);
}

/**
 * Guest contact + optional billing/tax fields. The draft-order API only
 * requires name, email and phone; everything else is optional. Tax/company
 * fields appear only when paying as a company. Logged-in visitors arrive with
 * name/email prefilled, so the only required field left is usually the phone.
 */
export function ContactBillingForm({
	error,
	onCancel,
	onChange,
	onSubmit,
	prefilledFromAccount,
	submitLabel,
	submitting,
	value,
}: ContactBillingFormProps) {
	const [showBilling, setShowBilling] = useState(false);

	const set = <Key extends keyof ContactDraft>(
		key: Key,
		next: ContactDraft[Key],
	) => onChange({ ...value, [key]: next });

	const complete = isContactComplete(value);

	return (
		<div className="flex flex-col gap-4">
			{prefilledFromAccount && (
				<CheckoutAlert variant="info">
					We filled in your account details. Add a phone number so the
					Alojamento Ideal team can reach you about your stay.
				</CheckoutAlert>
			)}

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<Field
					autoComplete="name"
					id="contact-name"
					label="Full name"
					onChange={(next) => set("name", next)}
					placeholder="Jane Doe"
					value={value.name}
				/>
				<Field
					autoComplete="email"
					id="contact-email"
					label="Email"
					onChange={(next) => set("email", next)}
					placeholder="jane@example.com"
					type="email"
					value={value.email}
				/>
			</div>

			<Field
				autoComplete="tel"
				id="contact-phone"
				label="Phone (with country code)"
				onChange={(next) => set("phone", next)}
				placeholder="+351 912 345 678"
				type="tel"
				value={value.phone}
			/>

			<div className="flex items-center gap-2">
				<Checkbox
					checked={value.isCompany}
					id="contact-is-company"
					onCheckedChange={(checked) => set("isCompany", checked === true)}
				/>
				<Label className="font-normal text-sm" htmlFor="contact-is-company">
					I'm booking as a company
				</Label>
			</div>

			{value.isCompany && (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<Field
						autoComplete="organization"
						id="contact-company"
						label="Company name"
						onChange={(next) => set("companyName", next)}
						value={value.companyName}
					/>
					<Field
						id="contact-tax"
						label="Tax number (optional)"
						onChange={(next) => set("taxNumber", next)}
						placeholder="For your invoice"
						value={value.taxNumber}
					/>
				</div>
			)}

			{showBilling ? (
				<div className="flex flex-col gap-4 rounded-xl border p-4">
					<Field
						autoComplete="address-line1"
						id="billing-line1"
						label="Address"
						onChange={(next) => set("line1", next)}
						value={value.line1}
					/>
					<Field
						autoComplete="address-line2"
						id="billing-line2"
						label="Apartment, suite (optional)"
						onChange={(next) => set("line2", next)}
						value={value.line2}
					/>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Field
							autoComplete="address-level2"
							id="billing-city"
							label="City"
							onChange={(next) => set("city", next)}
							value={value.city}
						/>
						<Field
							autoComplete="postal-code"
							id="billing-postal"
							label="Postal code"
							onChange={(next) => set("postalCode", next)}
							value={value.postalCode}
						/>
						<Field
							autoComplete="address-level1"
							id="billing-region"
							label="Region"
							onChange={(next) => set("region", next)}
							value={value.region}
						/>
						<Field
							autoComplete="country-name"
							id="billing-country"
							label="Country"
							onChange={(next) => set("country", next)}
							value={value.country}
						/>
					</div>
				</div>
			) : (
				<Button
					className="self-start p-0 text-sm underline"
					onClick={() => setShowBilling(true)}
					variant="link"
				>
					Add a billing address (optional)
				</Button>
			)}

			<div className="flex flex-col gap-1.5">
				<Label htmlFor="contact-notes">Notes for the team (optional)</Label>
				<Textarea
					id="contact-notes"
					onChange={(event) => set("notes", event.target.value)}
					placeholder="Arrival time, accessibility needs, anything we should know"
					value={value.notes}
				/>
			</div>

			{error && <CheckoutAlert variant="error">{error}</CheckoutAlert>}

			<div className="flex flex-wrap items-center gap-3">
				<Button disabled={!complete || submitting} onClick={onSubmit} size="lg">
					{submitting ? "Saving" : (submitLabel ?? "Continue to payment")}
				</Button>
				{onCancel && (
					<Button
						disabled={submitting}
						onClick={onCancel}
						size="lg"
						variant="ghost"
					>
						Cancel
					</Button>
				)}
			</div>
		</div>
	);
}
