"use client";

import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import { useEffect, useState } from "react";
import { CountrySelect } from "@/components/form/country-select";
import { PhoneInput } from "@/components/form/phone-input";
import { CheckoutAlert } from "./checkout-alert";
import {
	type ContactDraft,
	hasBillingDetails,
	isContactComplete,
} from "./types";

interface ContactBillingFormProps {
	/** When true, offer to save the entered contact/billing to the account. */
	canSaveToAccount: boolean;
	error: string | null;
	/** Optional secondary action; shown when editing already-saved contact. */
	onCancel?: () => void;
	onChange: (next: ContactDraft) => void;
	onSaveToAccountChange: (next: boolean) => void;
	onSubmit: () => void;
	prefilledFromAccount: boolean;
	saveToAccount: boolean;
	submitLabel?: string;
	submitting: boolean;
	value: ContactDraft;
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
	canSaveToAccount,
	error,
	onCancel,
	onChange,
	onSaveToAccountChange,
	onSubmit,
	prefilledFromAccount,
	saveToAccount,
	submitLabel,
	submitting,
	value,
}: ContactBillingFormProps) {
	const [showBilling, setShowBilling] = useState(() =>
		hasBillingDetails(value),
	);

	// Reveal the billing block once a saved address arrives via prefill. Never
	// auto-collapses, so a guest who opened it keeps it open.
	useEffect(() => {
		if (hasBillingDetails(value)) {
			setShowBilling(true);
		}
	}, [value]);

	const set = <Key extends keyof ContactDraft>(
		key: Key,
		next: ContactDraft[Key],
	) => onChange({ ...value, [key]: next });

	const complete = isContactComplete(value);

	return (
		<div className="flex flex-col gap-4">
			{prefilledFromAccount && (
				<CheckoutAlert variant="info">
					We filled in your account details.{" "}
					{value.phone
						? null
						: "Add a phone number so the Alojamento Ideal team can reach you about your stay."}
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

			<div className="flex flex-col gap-1.5">
				<Label htmlFor="contact-phone">Phone</Label>
				<PhoneInput
					id="contact-phone"
					onChange={(next) => set("phone", next)}
					value={value.phone}
				/>
			</div>

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
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="billing-country">Country</Label>
							<CountrySelect
								autoComplete="country"
								id="billing-country"
								onChange={(next) => set("country", next)}
								value={value.country}
							/>
						</div>
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

			{canSaveToAccount && (
				<div className="flex items-center gap-2">
					<Checkbox
						checked={saveToAccount}
						id="save-to-account"
						onCheckedChange={(checked) =>
							onSaveToAccountChange(checked === true)
						}
					/>
					<Label className="font-normal text-sm" htmlFor="save-to-account">
						Save this contact and billing info to my account for next time
					</Label>
				</div>
			)}

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
