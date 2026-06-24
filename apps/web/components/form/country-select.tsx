"use client";

import {
	NativeSelect,
	NativeSelectOption,
} from "@workspace/ui/components/native-select";
import { COUNTRY_OPTIONS } from "@/lib/site/countries";

interface CountrySelectProps {
	autoComplete?: string;
	className?: string;
	disabled?: boolean;
	id?: string;
	invalid?: boolean;
	onChange: (code: string) => void;
	placeholder?: string;
	/** ISO 3166-1 alpha-2 code, or "" for none. */
	value: string;
}

/**
 * Country picker built on the shadcn native select so the browser's accessible,
 * mobile-friendly picker is used while keeping the app's styling. Options show a
 * flag emoji plus the localized country name; the value is the ISO-2 code.
 * Shared by billing country, residence and nationality.
 */
export function CountrySelect({
	autoComplete,
	className,
	disabled,
	id,
	invalid,
	onChange,
	placeholder = "Select a country",
	value,
}: CountrySelectProps) {
	return (
		<NativeSelect
			aria-invalid={invalid || undefined}
			autoComplete={autoComplete}
			className={className ?? "w-full"}
			disabled={disabled}
			id={id}
			onChange={(event) => onChange(event.target.value)}
			value={value}
		>
			<NativeSelectOption value="">{placeholder}</NativeSelectOption>
			{COUNTRY_OPTIONS.map((country) => (
				<NativeSelectOption key={country.code} value={country.code}>
					{country.flag ? `${country.flag} ${country.name}` : country.name}
				</NativeSelectOption>
			))}
		</NativeSelect>
	);
}
