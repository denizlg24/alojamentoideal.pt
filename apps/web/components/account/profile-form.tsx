"use client";

import type { AccountProfile } from "@workspace/core/account";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useId, useState } from "react";
import { CountrySelect } from "@/components/form/country-select";
import { PhoneInput } from "@/components/form/phone-input";
import { profileUpdateSchema } from "@/lib/account/validation";
import { AccountSection } from "./account-ui";

/** All editable profile fields as form-friendly strings (null becomes ""). */
interface FormState {
	phoneE164: string;
	isCompany: boolean;
	companyName: string;
	taxNumber: string;
	billingLine1: string;
	billingLine2: string;
	billingCity: string;
	billingRegion: string;
	billingPostalCode: string;
	billingCountry: string;
	residenceCountry: string;
	nationality: string;
}

type FieldErrors = Partial<Record<keyof FormState, string>>;

type SaveStatus = "idle" | "saved" | "error";

function toFormState(profile: AccountProfile): FormState {
	return {
		phoneE164: profile.phoneE164 ?? "",
		isCompany: profile.isCompany,
		companyName: profile.companyName ?? "",
		taxNumber: profile.taxNumber ?? "",
		billingLine1: profile.billingLine1 ?? "",
		billingLine2: profile.billingLine2 ?? "",
		billingCity: profile.billingCity ?? "",
		billingRegion: profile.billingRegion ?? "",
		billingPostalCode: profile.billingPostalCode ?? "",
		billingCountry: profile.billingCountry ?? "",
		residenceCountry: profile.residenceCountry ?? "",
		nationality: profile.nationality ?? "",
	};
}

function isEqual(a: FormState, b: FormState): boolean {
	return (Object.keys(a) as (keyof FormState)[]).every(
		(key) => a[key] === b[key],
	);
}

interface FieldProps {
	autoComplete?: string;
	disabled?: boolean;
	error?: string;
	id: string;
	label: string;
	onChange: (value: string) => void;
	placeholder?: string;
	type?: string;
	value: string;
}

function Field({
	autoComplete,
	disabled,
	error,
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
				aria-invalid={error ? true : undefined}
				autoComplete={autoComplete}
				disabled={disabled}
				id={id}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				type={type}
				value={value}
			/>
			{error && <p className="text-destructive text-xs">{error}</p>}
		</div>
	);
}

function CountryField({
	disabled,
	error,
	id,
	label,
	onChange,
	value,
}: {
	disabled?: boolean;
	error?: string;
	id: string;
	label: string;
	onChange: (value: string) => void;
	value: string;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<CountrySelect
				disabled={disabled}
				id={id}
				invalid={Boolean(error)}
				onChange={onChange}
				value={value}
			/>
			{error && <p className="text-destructive text-xs">{error}</p>}
		</div>
	);
}

function TwoColumn({ children }: { children: ReactNode }) {
	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
	);
}

export function ProfileForm({
	initialProfile,
}: {
	initialProfile: AccountProfile;
}) {
	const baseId = useId();
	const initial = toFormState(initialProfile);
	const [baseline, setBaseline] = useState<FormState>(initial);
	const [draft, setDraft] = useState<FormState>(initial);
	const [errors, setErrors] = useState<FieldErrors>({});
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState<SaveStatus>("idle");
	const [formError, setFormError] = useState<string | null>(null);

	const dirty = !isEqual(draft, baseline);

	function set<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
		setDraft((current) => ({ ...current, [key]: value }));
		setStatus("idle");
		if (errors[key]) {
			setErrors((current) => ({ ...current, [key]: undefined }));
		}
	}

	function setCompanyBilling(isCompany: boolean) {
		setDraft((current) => ({
			...current,
			companyName: isCompany ? current.companyName : "",
			isCompany,
			taxNumber: isCompany ? current.taxNumber : "",
		}));
		setStatus("idle");
		setErrors((current) => ({
			...current,
			companyName: undefined,
			isCompany: undefined,
			taxNumber: undefined,
		}));
	}

	function reset() {
		setDraft(baseline);
		setErrors({});
		setStatus("idle");
		setFormError(null);
	}

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		const submitted = draft;
		const parsed = profileUpdateSchema.safeParse(submitted);
		if (!parsed.success) {
			const next: FieldErrors = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path[0] as keyof FormState | undefined;
				if (key && !next[key]) {
					next[key] = issue.message;
				}
			}
			setErrors(next);
			return;
		}

		setErrors({});
		setFormError(null);
		setSaving(true);
		// Optimistically promote the draft to the saved baseline so the form
		// settles immediately; roll back if the request fails.
		const previous = baseline;
		setBaseline(submitted);

		try {
			const response = await fetch("/api/account/profile", {
				body: JSON.stringify(submitted),
				headers: { "content-type": "application/json" },
				method: "PUT",
			});

			if (!response.ok) {
				setBaseline(previous);
				const body = (await response.json().catch(() => null)) as {
					issues?: { message: string; path: string }[];
				} | null;
				if (body?.issues?.length) {
					const next: FieldErrors = {};
					for (const issue of body.issues) {
						const key = issue.path as keyof FormState;
						if (!next[key]) {
							next[key] = issue.message;
						}
					}
					setErrors(next);
				}
				setStatus("error");
				setFormError("We could not save your changes. Please try again.");
				return;
			}

			const saved = (await response.json()) as AccountProfile;
			const reconciled = toFormState(saved);
			setBaseline(reconciled);
			setDraft(reconciled);
			setStatus("saved");
		} catch {
			setBaseline(previous);
			setStatus("error");
			setFormError("We could not reach the server. Please try again.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<form onSubmit={onSubmit}>
			<AccountSection
				title="Contact"
				description="How the Alojamento Ideal team reaches you about your stay."
			>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${baseId}-phone`}>Phone number</Label>
					<PhoneInput
						disabled={saving}
						id={`${baseId}-phone`}
						invalid={Boolean(errors.phoneE164)}
						onChange={(value) => set("phoneE164", value)}
						value={draft.phoneE164}
					/>
					{errors.phoneE164 && (
						<p className="text-destructive text-xs">{errors.phoneE164}</p>
					)}
				</div>
			</AccountSection>

			<AccountSection
				title="Billing"
				description="Used to issue invoices for your bookings."
			>
				<div className="flex items-center gap-2">
					<Checkbox
						checked={draft.isCompany}
						disabled={saving}
						id={`${baseId}-is-company`}
						onCheckedChange={(checked) => setCompanyBilling(checked === true)}
					/>
					<Label className="font-normal" htmlFor={`${baseId}-is-company`}>
						I'm booking on behalf of a company
					</Label>
				</div>

				{draft.isCompany && (
					<TwoColumn>
						<Field
							error={errors.companyName}
							disabled={saving}
							id={`${baseId}-company`}
							label="Company name"
							onChange={(value) => set("companyName", value)}
							value={draft.companyName}
						/>
						<Field
							error={errors.taxNumber}
							disabled={saving}
							id={`${baseId}-tax`}
							label="Tax number"
							onChange={(value) => set("taxNumber", value)}
							value={draft.taxNumber}
						/>
					</TwoColumn>
				)}

				<Field
					autoComplete="address-line1"
					disabled={saving}
					error={errors.billingLine1}
					id={`${baseId}-line1`}
					label="Address"
					onChange={(value) => set("billingLine1", value)}
					placeholder="Street and number"
					value={draft.billingLine1}
				/>
				<Field
					autoComplete="address-line2"
					disabled={saving}
					error={errors.billingLine2}
					id={`${baseId}-line2`}
					label="Apartment, suite, etc. (optional)"
					onChange={(value) => set("billingLine2", value)}
					value={draft.billingLine2}
				/>
				<TwoColumn>
					<Field
						autoComplete="address-level2"
						disabled={saving}
						error={errors.billingCity}
						id={`${baseId}-city`}
						label="City"
						onChange={(value) => set("billingCity", value)}
						value={draft.billingCity}
					/>
					<Field
						autoComplete="address-level1"
						disabled={saving}
						error={errors.billingRegion}
						id={`${baseId}-region`}
						label="Region (optional)"
						onChange={(value) => set("billingRegion", value)}
						value={draft.billingRegion}
					/>
				</TwoColumn>
				<TwoColumn>
					<Field
						autoComplete="postal-code"
						disabled={saving}
						error={errors.billingPostalCode}
						id={`${baseId}-postal`}
						label="Postal code"
						onChange={(value) => set("billingPostalCode", value)}
						value={draft.billingPostalCode}
					/>
					<CountryField
						disabled={saving}
						error={errors.billingCountry}
						id={`${baseId}-billing-country`}
						label="Country"
						onChange={(value) => set("billingCountry", value)}
						value={draft.billingCountry}
					/>
				</TwoColumn>
			</AccountSection>

			<AccountSection
				title="Residence"
				description="Where you live and your nationality, for your guest profile."
			>
				<TwoColumn>
					<CountryField
						disabled={saving}
						error={errors.residenceCountry}
						id={`${baseId}-residence`}
						label="Country of residence"
						onChange={(value) => set("residenceCountry", value)}
						value={draft.residenceCountry}
					/>
					<CountryField
						disabled={saving}
						error={errors.nationality}
						id={`${baseId}-nationality`}
						label="Nationality"
						onChange={(value) => set("nationality", value)}
						value={draft.nationality}
					/>
				</TwoColumn>
			</AccountSection>

			<div className="flex items-center justify-end gap-4 pt-6 pb-4">
				<span
					aria-live="polite"
					className={cn(
						"text-sm",
						status === "saved" && "text-muted-foreground",
						status === "error" && "text-destructive",
					)}
				>
					{formError ??
						(status === "saved" ? "All changes saved" : dirty ? "" : "")}
				</span>
				{dirty && !saving && (
					<Button onClick={reset} type="button" variant="ghost">
						Cancel
					</Button>
				)}
				<Button disabled={!dirty || saving} type="submit">
					{saving ? "Saving…" : "Save changes"}
				</Button>
			</div>
		</form>
	);
}
