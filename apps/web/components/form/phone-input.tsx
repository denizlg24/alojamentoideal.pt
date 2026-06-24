"use client";

import { Input } from "@workspace/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@workspace/ui/components/native-select";
import { useEffect, useState } from "react";
import {
	countryForDialCode,
	dialCode,
	PHONE_COUNTRY_OPTIONS,
} from "@/lib/site/countries";

const DEFAULT_COUNTRY = "PT";

/** Splits an E.164 string into its country and national parts for display. */
function parsePhone(value: string): {
	country: string | null;
	national: string;
} {
	const trimmed = value.trim();
	if (!trimmed) {
		return { country: null, national: "" };
	}
	if (!trimmed.startsWith("+")) {
		return { country: null, national: trimmed.replace(/\D/g, "") };
	}

	const digits = trimmed.slice(1).replace(/\D/g, "");
	let best: { code: string; dialCode: string } | null = null;
	for (const option of PHONE_COUNTRY_OPTIONS) {
		if (
			digits.startsWith(option.dialCode) &&
			(!best || option.dialCode.length > best.dialCode.length)
		) {
			best = { code: option.code, dialCode: option.dialCode };
		}
	}

	if (!best) {
		return { country: null, national: digits };
	}
	const country = countryForDialCode(best.dialCode) ?? best.code;
	return { country, national: digits.slice(best.dialCode.length) };
}

/** Joins a country + national number into E.164, or "" when there's no number. */
function composePhone(country: string, national: string): string {
	const digits = national.replace(/\D/g, "");
	if (!digits) {
		return "";
	}
	const dial = dialCode(country);
	return dial ? `+${dial}${digits}` : `+${digits}`;
}

interface PhoneInputProps {
	id?: string;
	invalid?: boolean;
	onChange: (value: string) => void;
	placeholder?: string;
	/** Full E.164 number (e.g. "+351912345678") or "". */
	value: string;
}

/**
 * Phone field with a flag + dialing-code country picker beside a national-number
 * input. Emits a single E.164 string. The country picker reuses the same native
 * select as {@link CountrySelect} for a consistent, mobile-friendly experience.
 */
export function PhoneInput({
	id,
	invalid,
	onChange,
	placeholder,
	value,
}: PhoneInputProps) {
	const initial = parsePhone(value);
	const [country, setCountry] = useState(initial.country ?? DEFAULT_COUNTRY);
	const [national, setNational] = useState(initial.national);

	// Re-sync when `value` changes from outside (prefill / reset). Skipped for our
	// own emits, since those leave `value` equal to what we'd recompose.
	// biome-ignore lint/correctness/useExhaustiveDependencies: react only to external value changes; local state is otherwise the source of truth.
	useEffect(() => {
		if (value !== composePhone(country, national)) {
			const parsed = parsePhone(value);
			setCountry(parsed.country ?? DEFAULT_COUNTRY);
			setNational(parsed.national);
		}
	}, [value]);

	function update(nextCountry: string, nextNational: string) {
		setCountry(nextCountry);
		setNational(nextNational);
		onChange(composePhone(nextCountry, nextNational));
	}

	return (
		<div className="flex gap-2">
			<NativeSelect
				aria-label="Country dialing code"
				className="w-28 shrink-0"
				onChange={(event) => update(event.target.value, national)}
				value={country}
			>
				{PHONE_COUNTRY_OPTIONS.map((option) => (
					<NativeSelectOption key={option.code} value={option.code}>
						{option.flag
							? `${option.flag} +${option.dialCode}`
							: `+${option.dialCode}`}
					</NativeSelectOption>
				))}
			</NativeSelect>
			<Input
				aria-invalid={invalid || undefined}
				autoComplete="tel-national"
				className="flex-1"
				id={id}
				inputMode="tel"
				onChange={(event) => update(country, event.target.value)}
				placeholder={placeholder ?? "912 345 678"}
				type="tel"
				value={national}
			/>
		</div>
	);
}
