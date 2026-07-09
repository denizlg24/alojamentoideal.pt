"use client";

import { ResponsiveSelect } from "@workspace/ui/components/responsive-select";
import { useMemo } from "react";
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
 * Country picker shared by billing country, residence and nationality. Options
 * show a flag emoji plus the localized country name; the value is the ISO-2
 * code.
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
	const options = useMemo(
		() => [
			{ label: placeholder, value: "" },
			...COUNTRY_OPTIONS.map((country) => ({
				label: country.flag ? `${country.flag} ${country.name}` : country.name,
				value: country.code,
			})),
		],
		[placeholder],
	);

	return (
		<ResponsiveSelect
			aria-invalid={invalid || undefined}
			autoComplete={autoComplete}
			className={className ?? "w-full"}
			disabled={disabled}
			id={id}
			onValueChange={onChange}
			options={options}
			value={value}
		/>
	);
}
